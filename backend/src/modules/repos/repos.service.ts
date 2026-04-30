import Anthropic from '@anthropic-ai/sdk';
import {
  Injectable,
  Logger,
  ForbiddenException,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { ethers } from 'ethers';

import { decryptToken } from '../../common/crypto/token-cipher.util';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RedisService } from '../../common/redis/redis.service';
import { isSafeUrl } from '../../common/sanitize/sanitize.util';
import { ChartService } from '../chart/chart.service';
import { EmailService } from '../email/email.service';
import { MarketGateway } from '../market/market.gateway';
import { ReputationService } from '../reputation/reputation.service';

@Injectable()
export class ReposService {
  private readonly logger = new Logger(ReposService.name);
  private readonly anthropic: Anthropic;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly config: ConfigService,
    private readonly chart: ChartService,
    private readonly reputation: ReputationService,
    private readonly email: EmailService,
    private readonly marketGateway: MarketGateway,
  ) {
    this.anthropic = new Anthropic({
      apiKey: this.config.get<string>('ANTHROPIC_API_KEY') || '',
    });
  }

  /** Ordered list of Base RPCs we try before giving up. The configured
   *  one goes first; public Base endpoints follow so a bad ETH_RPC_URL
   *  on Render doesn't break every purchase. */
  private baseRpcCandidates(): string[] {
    const configured = this.config.get<string>('ETH_RPC_URL', '');
    return [
      configured,
      'https://mainnet.base.org',
      'https://base.publicnode.com',
      'https://base.llamarpc.com',
    ].filter((url, i, arr) => url && arr.indexOf(url) === i);
  }

  /**
   * Poll for a tx receipt, handling the common case where the buyer's wallet
   * has broadcast the tx but the Base RPC hasn't indexed it yet (receipt =
   * null). Waits up to `timeoutMs` before giving up. Fails over across the
   * RPC candidate list on each retry so one laggy endpoint doesn't take
   * the whole purchase flow down.
   */
  private async waitForReceipt(
    _provider: ethers.JsonRpcProvider,
    txHash: string,
    timeoutMs = 30_000,
  ): Promise<ethers.TransactionReceipt | null> {
    const deadline = Date.now() + timeoutMs;
    let delay = 1500;
    const candidates = this.baseRpcCandidates();
    let idx = 0;
    for (;;) {
      const rpcUrl = candidates[idx % candidates.length];
      try {
        const provider = new ethers.JsonRpcProvider(rpcUrl);
        const receipt = await provider.getTransactionReceipt(txHash);
        if (receipt) return receipt;
      } catch (err) {
        this.logger.warn(
          `receipt fetch ${rpcUrl} for ${txHash}: ${err instanceof Error ? err.message : err}`,
        );
      }
      if (Date.now() >= deadline) return null;
      await new Promise((r) => setTimeout(r, delay));
      delay = Math.min(delay * 1.5, 5000);
      idx++;
    }
  }

  /** Fetch a Base tx across the RPC candidate list until one returns it.
   *  Returns null when every candidate times out or errors. */
  private async fetchBaseTx(txHash: string): Promise<ethers.TransactionResponse | null> {
    for (const rpcUrl of this.baseRpcCandidates()) {
      try {
        const provider = new ethers.JsonRpcProvider(rpcUrl);
        const tx = await provider.getTransaction(txHash);
        if (tx) return tx;
      } catch (err) {
        this.logger.warn(
          `getTransaction ${rpcUrl} for ${txHash}: ${err instanceof Error ? err.message : err}`,
        );
      }
    }
    return null;
  }

  /**
   * Load every wallet address the buyer has proven ownership of — the
   * primary walletAddress on their User row, plus any linked UserWallet
   * entries. Returned as a lowercased Set for case-insensitive comparison
   * against on-chain values. Used to enforce that the tx payer IS the
   * authenticated buyer, closing the txHash-replay attack where an
   * attacker would submit someone else's on-chain payment.
   */
  private async buyerWallets(buyerId: string): Promise<Set<string>> {
    const [user, wallets] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: buyerId },
        select: { walletAddress: true },
      }),
      this.prisma.userWallet.findMany({
        where: { userId: buyerId },
        select: { address: true },
      }),
    ]);
    const set = new Set<string>();
    if (user?.walletAddress) set.add(user.walletAddress.toLowerCase());
    for (const w of wallets) {
      if (w.address) set.add(w.address.toLowerCase());
    }
    return set;
  }

  /** Parse JSON from Claude response text */
  private parseJson(text: string): { safe: boolean; reason: string } | null {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      const parsed = JSON.parse(match[0]);
      return { safe: Boolean(parsed.safe), reason: String(parsed.reason || '') };
    } catch {
      return null;
    }
  }

  /**
   * Two-tier Claude security scan (mirrors the image):
   *  Tier 1 — Haiku: fast initial analysis
   *  Tier 2 — Sonnet: deep analysis only when Haiku flags something suspicious
   */
  private async scanRepoContent(
    name: string,
    description: string,
    topics: string[],
  ): Promise<{ safe: boolean; reason: string }> {
    const basePrompt = `You are a security moderator for a developer platform.

REJECT (safe=false) if name/description suggests:
- Malware, spyware, ransomware, keylogger, RAT
- Credential/password stealers, phishing kits
- DDoS or network attack tools
- Crypto wallet drainers or private key stealers
- Clearly illegal hacking tools targeting production systems

ACCEPT (safe=true) for: legitimate open-source projects, developer tools, bots, trading scripts, automation utilities, security research.

Name: ${name}
Description: ${description.slice(0, 500)}
Topics: ${topics.slice(0, 10).join(', ')}

Reply ONLY with JSON: {"safe": true|false, "reason": "brief reason"}`;

    try {
      // ── Tier 1: Haiku — fast scan ──────────────────────────────────────────
      const haikuRes = await this.anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 256,
        messages: [{ role: 'user', content: basePrompt }],
      });
      const haikuText = (haikuRes.content[0] as { type: string; text: string }).text ?? '';
      const haikuResult = this.parseJson(haikuText);

      // If Haiku clears it → safe, no need for Sonnet
      if (haikuResult?.safe) {
        return { safe: true, reason: haikuResult.reason };
      }

      // ── Tier 2: Sonnet — deep analysis when suspicious ─────────────────────
      this.logger.warn(`Haiku flagged "${name}" — escalating to Sonnet`);
      const sonnetRes = await this.anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 512,
        messages: [
          {
            role: 'user',
            content: `${basePrompt}

NOTE: A preliminary scan flagged this as potentially suspicious. Perform a thorough analysis before making a final decision. Consider context carefully — security research and ethical hacking tools are acceptable.`,
          },
        ],
      });
      const sonnetText = (sonnetRes.content[0] as { type: string; text: string }).text ?? '';
      const sonnetResult = this.parseJson(sonnetText);
      if (sonnetResult) return sonnetResult;
    } catch (err) {
      this.logger.error('Repo content scan failed', err);
    }

    return { safe: true, reason: 'Scan unavailable — logged for manual review' };
  }

  // ── GitHub API fetch (server-side, no SSRF) ───────────────────────────────

  async fetchGitHubRepos(
    githubLogin: string,
    accessToken?: string,
    userId?: string,
  ): Promise<unknown[]> {
    // If no cookie token, try to get it from the database
    let token = accessToken;
    if (!token && userId) {
      const userRecord = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { githubToken: true },
      });
      token = decryptToken(userRecord?.githubToken) ?? undefined;
    }

    // No token at all — user connected GitHub before but token is gone, needs re-auth
    if (!token && userId) {
      this.logger.warn(`No GitHub token for user ${userId} (${githubLogin}) — need re-auth`);
      return [
        {
          _bolty_reauth: true,
          name: 'Reconecta GitHub para ver todos tus repos',
          id: -1,
          full_name: 'reauth',
          html_url: '',
          stargazers_count: 0,
          forks_count: 0,
        },
      ] as unknown[];
    }

    const cacheKey = `gh_repos:${githubLogin}:${token ? 'auth' : 'public'}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) return JSON.parse(cached) as unknown[];

    const headers: Record<string, string> = {
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'Bolty-Platform/1.0',
    };

    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    let allRepos: unknown[] = [];

    if (token) {
      // First: check if token has 'repo' scope by making a lightweight call
      let needsReauth = false;
      try {
        const checkResp = await axios.get('https://api.github.com/user', {
          headers,
          timeout: 10000,
        });
        const scopes = (checkResp.headers?.['x-oauth-scopes'] as string) || '';
        this.logger.log(`GitHub token scopes for ${githubLogin}: [${scopes}]`);

        if (
          !scopes
            .split(',')
            .map((s: string) => s.trim())
            .includes('repo')
        ) {
          this.logger.warn(
            `Token for ${githubLogin} lacks 'repo' scope. Revoking to force re-auth.`,
          );
          needsReauth = true;

          // Revoke the old token via GitHub API so next OAuth gives fresh scopes
          const clientId = this.config.get<string>('GITHUB_CLIENT_ID') || '';
          const clientSecret = this.config.get<string>('GITHUB_CLIENT_SECRET') || '';
          try {
            await axios.delete(`https://api.github.com/applications/${clientId}/token`, {
              auth: { username: clientId, password: clientSecret },
              data: { access_token: token },
              headers: { Accept: 'application/vnd.github.v3+json' },
              timeout: 10000,
            });
            this.logger.log(`Revoked old GitHub token for ${githubLogin}`);
          } catch (revokeErr) {
            this.logger.warn(`Failed to revoke GitHub token: ${revokeErr}`);
          }

          // Clear stored token since it's now revoked
          if (userId) {
            await this.prisma.user.update({
              where: { id: userId },
              data: { githubToken: null },
            });
          }
        }
      } catch (scopeCheckErr) {
        // Token is invalid or expired — treat as needing reauth
        this.logger.warn(`GitHub scope check failed for ${githubLogin}: ${scopeCheckErr}`);
        needsReauth = true;
        if (userId) {
          await this.prisma.user
            .update({ where: { id: userId }, data: { githubToken: null } })
            .catch(() => {});
        }
      }

      if (needsReauth) {
        // Return empty list with reauth notice — token was revoked
        return [
          {
            _bolty_reauth: true,
            name: 'Reconecta GitHub para ver todos tus repos (públicos y privados)',
            id: -1,
            full_name: 'reauth',
            html_url: '',
            stargazers_count: 0,
            forks_count: 0,
          },
        ] as unknown[];
      }

      // Token has correct scopes — fetch all repos
      let page = 1;
      try {
        // eslint-disable-next-line no-constant-condition
        while (true) {
          const url = `https://api.github.com/user/repos?per_page=100&page=${page}&sort=updated&type=all`;
          if (!isSafeUrl(url)) throw new BadRequestException('Invalid GitHub request');

          const response = await axios.get<unknown[]>(url, { headers, timeout: 10000 });
          this.logger.log(`GitHub returned ${response.data?.length ?? 0} repos on page ${page}`);

          const batch = response.data;
          if (!batch || batch.length === 0) break;

          allRepos = allRepos.concat(batch);
          if (batch.length < 100) break;
          page++;
        }
      } catch (fetchErr) {
        this.logger.warn(`GitHub repo fetch failed for ${githubLogin}: ${fetchErr}`);
        if (userId) {
          await this.prisma.user
            .update({ where: { id: userId }, data: { githubToken: null } })
            .catch(() => {});
        }
        return [
          {
            _bolty_reauth: true,
            name: 'Reconecta GitHub para ver todos tus repos (públicos y privados)',
            id: -1,
            full_name: 'reauth',
            html_url: '',
            stargazers_count: 0,
            forks_count: 0,
          },
        ] as unknown[];
      }
    } else {
      // No token: use public API (only returns public repos)
      let page = 1;
      this.logger.warn(`No GitHub token for ${githubLogin} — falling back to public API`);
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const url = `https://api.github.com/users/${encodeURIComponent(githubLogin)}/repos?per_page=100&page=${page}&sort=updated`;
        if (!isSafeUrl(url)) throw new BadRequestException('Invalid GitHub request');

        const response = await axios.get<unknown[]>(url, { headers, timeout: 10000 });
        const batch = response.data;
        if (!batch || batch.length === 0) break;

        allRepos = allRepos.concat(batch);
        if (batch.length < 100) break;
        page++;
      }
    }

    // Cache for 5 minutes
    await this.redis.set(cacheKey, JSON.stringify(allRepos), 300);

    return allRepos;
  }

  async clearGitHubReposCache(githubLogin: string): Promise<void> {
    await Promise.all([
      this.redis.del(`gh_repos:${githubLogin}:auth`),
      this.redis.del(`gh_repos:${githubLogin}:public`),
    ]);
  }

  // ── Publish repository to platform ───────────────────────────────────────

  async publishRepository(
    userId: string,
    githubRepoData: {
      id: number;
      name: string;
      full_name: string;
      description?: string;
      language?: string;
      stargazers_count: number;
      forks_count: number;
      html_url: string;
      clone_url: string;
      topics?: string[];
      private?: boolean;
      isLocked?: boolean;
      lockedPriceUsd?: number;
      logoUrl?: string;
      websiteUrl?: string;
      twitterUrl?: string;
    },
  ) {
    const isLocked = githubRepoData.isLocked === true;

    // ── GitHub ownership verification ─────────────────────────────────────
    // Never trust the client's copy of id/full_name/stars/private — that's
    // how a user publishes someone else's repo under their own account.
    // Pull the authoritative repo metadata from the GitHub API using the
    // caller's OAuth token and require that they are the owner (or a
    // repo admin). Mass-assignable client fields are then overwritten.
    const ownerRecord = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { githubToken: true, githubLogin: true },
    });
    const token = decryptToken(ownerRecord?.githubToken) ?? undefined;
    if (!token) {
      throw new ForbiddenException('Reconnect GitHub to publish this repository');
    }
    if (!/^[\w.-]+\/[\w.-]+$/.test(githubRepoData.full_name)) {
      throw new BadRequestException('Invalid repository full name');
    }
    interface GithubRepoPayload {
      id: number;
      name: string;
      full_name: string;
      description: string | null;
      language: string | null;
      stargazers_count: number;
      forks_count: number;
      html_url: string;
      clone_url: string;
      topics: string[] | null;
      private: boolean;
      owner: { login: string };
      permissions?: { admin?: boolean };
    }
    let authoritative: GithubRepoPayload;
    try {
      const resp = await axios.get<GithubRepoPayload>(
        `https://api.github.com/repos/${githubRepoData.full_name}`,
        {
          headers: {
            Accept: 'application/vnd.github.v3+json',
            'User-Agent': 'Bolty-Platform/1.0',
            Authorization: `Bearer ${token}`,
          },
          timeout: 10_000,
          validateStatus: () => true,
        },
      );
      if (resp.status === 404) {
        throw new NotFoundException('Repository not found on GitHub');
      }
      if (resp.status === 401 || resp.status === 403) {
        throw new ForbiddenException('GitHub token lacks permission for this repository');
      }
      if (resp.status !== 200 || !resp.data?.id) {
        throw new BadRequestException('Could not fetch repository metadata from GitHub');
      }
      authoritative = resp.data;
    } catch (err) {
      if (err instanceof NotFoundException || err instanceof ForbiddenException) throw err;
      if (err instanceof BadRequestException) throw err;
      this.logger.error(`GitHub verify failed: ${err instanceof Error ? err.message : err}`);
      throw new BadRequestException('Could not verify repository ownership with GitHub');
    }

    const isOwner =
      authoritative.owner.login.toLowerCase() === (ownerRecord?.githubLogin || '').toLowerCase();
    const isAdmin = authoritative.permissions?.admin === true;
    if (!isOwner && !isAdmin) {
      throw new ForbiddenException('You do not own this repository');
    }
    const isPrivate = authoritative.private;

    if (isPrivate && !isLocked) {
      throw new BadRequestException(
        'Private repositories must be published as locked with a price',
      );
    }
    if (isLocked && (!githubRepoData.lockedPriceUsd || githubRepoData.lockedPriceUsd <= 0)) {
      throw new BadRequestException('Locked repositories must have a price greater than 0');
    }

    // Validate URLs — only for public (non-private) repos since private clone URLs need auth
    if (!isPrivate) {
      if (!isSafeUrl(authoritative.html_url) || !isSafeUrl(authoritative.clone_url)) {
        throw new BadRequestException('Invalid repository URLs');
      }
    } else if (!isSafeUrl(authoritative.html_url)) {
      throw new BadRequestException('Invalid repository URL');
    }

    // AI content security scan (use authoritative name/desc/topics)
    const scan = await this.scanRepoContent(
      authoritative.name,
      authoritative.description || '',
      authoritative.topics || [],
    );
    if (!scan.safe) {
      this.logger.warn(`Repo ${authoritative.name} rejected by AI scanner: ${scan.reason}`);
      throw new ForbiddenException(`Repository rejected by security scanner: ${scan.reason}`);
    }

    // Block cross-user hijack: if another Bolty account already claimed
    // this GitHub repo id, only that owner may update it.
    const existing = await this.prisma.repository.findUnique({
      where: { githubRepoId: String(authoritative.id) },
      select: { userId: true },
    });
    if (existing && existing.userId !== userId) {
      throw new ForbiddenException('This repository is already published under another account');
    }

    const saved = await this.prisma.repository.upsert({
      where: { githubRepoId: String(authoritative.id) },
      create: {
        githubRepoId: String(authoritative.id),
        name: authoritative.name.slice(0, 100),
        fullName: authoritative.full_name.slice(0, 200),
        description: authoritative.description?.slice(0, 1000) || null,
        language: authoritative.language?.slice(0, 50) || null,
        stars: authoritative.stargazers_count,
        forks: authoritative.forks_count,
        githubUrl: authoritative.html_url,
        cloneUrl: authoritative.clone_url,
        topics: authoritative.topics || [],
        isPrivate,
        isLocked,
        lockedPriceUsd: isLocked ? githubRepoData.lockedPriceUsd : null,
        logoUrl: githubRepoData.logoUrl?.slice(0, 500) || null,
        websiteUrl: githubRepoData.websiteUrl?.slice(0, 500) || null,
        twitterUrl: githubRepoData.twitterUrl?.slice(0, 500) || null,
        userId,
      },
      update: {
        stars: authoritative.stargazers_count,
        forks: authoritative.forks_count,
        description: authoritative.description?.slice(0, 1000) || null,
        isLocked,
        lockedPriceUsd: isLocked ? githubRepoData.lockedPriceUsd : null,
        logoUrl: githubRepoData.logoUrl?.slice(0, 500) || null,
        websiteUrl: githubRepoData.websiteUrl?.slice(0, 500) || null,
        twitterUrl: githubRepoData.twitterUrl?.slice(0, 500) || null,
      },
    });

    // Only award reputation on first-time publish (not on update).
    if (!existing) {
      this.reputation
        .awardPoints(userId, 'REPO_PUBLISHED', saved.id, saved.fullName)
        .catch((err) =>
          this.logger.warn(
            `Reputation award failed for repo ${saved.id}: ${err instanceof Error ? err.message : err}`,
          ),
        );
    }

    return saved;
  }

  // ── List platform repositories ────────────────────────────────────────────

  async listRepositories(params: {
    page?: number;
    limit?: number;
    language?: string;
    search?: string;
    sortBy?: 'votes' | 'stars' | 'recent' | 'downloads';
  }) {
    const { page = 1, limit = 20, language, search, sortBy = 'recent' } = params;
    const skip = (page - 1) * Math.min(limit, 50);
    const take = Math.min(limit, 50);

    // 30s Redis cache keyed on all params (skip for search — too many combos).
    const repoCacheKey = !search ? `repos:list:${language ?? ''}:${sortBy}:${page}:${take}` : null;
    if (repoCacheKey) {
      const hit = await this.redis.get(repoCacheKey).catch(() => null);
      if (hit)
        return JSON.parse(hit) as {
          data: object[];
          meta: { total: number; page: number; limit: number; pages: number };
        };
    }

    const where: Record<string, unknown> = {
      // Show public repos OR locked repos (private locked repos are visible but content is hidden)
      OR: [{ isPrivate: false }, { isLocked: true }],
      ...(language ? { language: { equals: language, mode: 'insensitive' as const } } : {}),
      ...(search
        ? {
            AND: [
              {
                OR: [
                  { name: { contains: search, mode: 'insensitive' as const } },
                  { description: { contains: search, mode: 'insensitive' as const } },
                ],
              },
            ],
          }
        : {}),
    };

    const orderBy =
      sortBy === 'stars'
        ? { stars: 'desc' as const }
        : sortBy === 'downloads'
          ? { downloadCount: 'desc' as const }
          : { createdAt: 'desc' as const };

    const [repos, total] = await Promise.all([
      this.prisma.repository.findMany({
        where,
        skip,
        take,
        orderBy,
        include: {
          user: { select: { username: true, avatarUrl: true } },
        },
      }),
      this.prisma.repository.count({ where }),
    ]);

    // Vote tallies in ONE groupBy across the page instead of one query per row.
    // Was 1 + N queries (~20 round-trips per /repos page); now 2.
    const repoIds = repos.map((r) => r.id);
    const voteAgg = repoIds.length
      ? await this.prisma.vote.groupBy({
          by: ['repositoryId', 'value'],
          where: { repositoryId: { in: repoIds } },
          _count: { _all: true },
        })
      : [];

    const tally = new Map<string, { up: number; down: number }>();
    for (const row of voteAgg) {
      const t = tally.get(row.repositoryId) ?? { up: 0, down: 0 };
      if (row.value === 'UP') t.up = row._count._all;
      else if (row.value === 'DOWN') t.down = row._count._all;
      tally.set(row.repositoryId, t);
    }

    const reposWithVotes = repos.map((repo) => {
      const t = tally.get(repo.id) ?? { up: 0, down: 0 };
      return { ...repo, upvotes: t.up, downvotes: t.down, score: t.up - t.down };
    });

    if (sortBy === 'votes') {
      reposWithVotes.sort((a, b) => b.score - a.score);
    }

    const result = {
      data: reposWithVotes,
      meta: { total, page, limit: take, pages: Math.ceil(total / take) },
    };
    if (repoCacheKey) {
      this.redis.set(repoCacheKey, JSON.stringify(result), 30).catch(() => null);
    }
    return result;
  }

  // ── Voting ────────────────────────────────────────────────────────────────

  async vote(userId: string, repositoryId: string, value: 'UP' | 'DOWN') {
    const repo = await this.prisma.repository.findUnique({
      where: { id: repositoryId },
    });
    if (!repo) throw new NotFoundException('Repository not found');

    // Prevent voting on own repos
    if (repo.userId === userId) {
      throw new ForbiddenException('Cannot vote on your own repository');
    }

    // Vote rate limiting
    const rateKey = `vote_rate:${userId}`;
    const count = await this.redis.incr(rateKey);
    if (count === 1) await this.redis.expire(rateKey, 3600); // 1 hour
    if (count > 50) throw new ForbiddenException('Vote rate limit exceeded');

    // Check the prior vote so we only award rays when the vote flips TO 'UP'
    // — not on every re-upvote or on downvotes.
    const priorVote = await this.prisma.vote.findUnique({
      where: { userId_repositoryId: { userId, repositoryId } },
      select: { value: true },
    });

    const result = await this.prisma.vote.upsert({
      where: { userId_repositoryId: { userId, repositoryId } },
      create: { userId, repositoryId, value },
      update: { value },
    });

    // Award the repo owner rays on each new distinct upvote.
    if (value === 'UP' && priorVote?.value !== 'UP') {
      this.reputation
        .awardPoints(repo.userId, 'REPO_UPVOTE_RECEIVED', repositoryId, repo.name)
        .catch((err) =>
          this.logger.warn(
            `Reputation award failed for upvote on repo ${repositoryId}: ${err instanceof Error ? err.message : err}`,
          ),
        );
    }

    return result;
  }

  async removeVote(userId: string, repositoryId: string) {
    await this.prisma.vote.deleteMany({
      where: { userId, repositoryId },
    });
  }

  // ── Download tracking ─────────────────────────────────────────────────────

  async trackDownload(repositoryId: string, userId: string) {
    const repo = await this.prisma.repository.findUnique({
      where: { id: repositoryId },
      select: { cloneUrl: true, githubUrl: true, isLocked: true, userId: true },
    });
    if (!repo) throw new NotFoundException('Repository not found');

    // Validate URL before returning it
    if (!isSafeUrl(repo.githubUrl)) {
      throw new BadRequestException('Invalid repository URL');
    }

    // Locked repos: only the owner OR a paying buyer gets the download URL.
    // Owners always have access to their own content — without this the owner
    // can't pull their own repo back after locking it.
    if (repo.isLocked && repo.userId !== userId) {
      const purchase = await this.prisma.repoPurchase.findFirst({
        where: { buyerId: userId, repositoryId, verified: true },
        select: { id: true },
      });
      if (!purchase) {
        throw new ForbiddenException('Purchase required to download this repository');
      }
    }

    // Dedupe metric inflation: one download counted per user per 24h.
    // Otherwise a single account can loop this endpoint to game rankings.
    const dedupKey = `repo_dl:${repositoryId}:${userId}`;
    const seen = await this.redis.get(dedupKey);
    if (!seen) {
      await this.redis.set(dedupKey, '1', 86_400);
      await this.prisma.repository.update({
        where: { id: repositoryId },
        data: { downloadCount: { increment: 1 } },
      });
    }

    return { downloadUrl: repo.githubUrl + '/archive/refs/heads/main.zip' };
  }

  async getRepository(id: string, userId?: string) {
    const repo = await this.prisma.repository.findUnique({
      where: { id },
      include: {
        user: {
          select: { username: true, displayName: true, avatarUrl: true, walletAddress: true },
        },
        votes: userId ? { where: { userId } } : false,
        _count: { select: { votes: true } },
      },
    });
    if (!repo) throw new NotFoundException('Repository not found');
    return repo;
  }

  /** Bulk lookup — same row shape as getRepository, but one round-trip
   *  for an explicit id list. Caller is the favorites page; the cap at
   *  100 ids is enforced by the controller's parseIdList. Preserves the
   *  caller's id ordering since favorites are user-ordered. */
  async getRepositoriesByIds(ids: string[]) {
    if (ids.length === 0) return [];
    const rows = await this.prisma.repository.findMany({
      where: { id: { in: ids } },
      include: {
        user: {
          select: { username: true, displayName: true, avatarUrl: true, walletAddress: true },
        },
        _count: { select: { votes: true } },
      },
    });
    const byId = new Map(rows.map((r) => [r.id, r]));
    return ids.map((id) => byId.get(id)).filter((r): r is NonNullable<typeof r> => !!r);
  }

  // ── Purchase (locked repos) ────────────────────────────────────────────────

  /**
   * Recovery flow for buyers whose payment landed on-chain but no
   * repoPurchase row ever materialised (pre-fix builds, RPC drop, etc).
   * Given just the buyer's tx hash, we fetch the tx, read the recipient
   * address, find the seller it belongs to, narrow to their locked repos
   * that match the paid amount (with the same 5% slippage the regular
   * purchase flow uses), and call `purchaseRepository` with the resolved
   * repoId — so the normal verification + broadcast + rays pipeline runs.
   *
   * If `sellerUsername` is provided, we scope the search to that user's
   * repos to handle the case where a seller has several locked repos at
   * similar prices.
   */
  async recoverPurchaseByTxHash(buyerId: string, txHash: string, sellerUsername?: string) {
    if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
      throw new BadRequestException('Invalid transaction hash');
    }

    // First: if we already have a row for this txHash, just re-run verify.
    const existingRow = await this.prisma.repoPurchase.findUnique({
      where: { txHash },
      select: { repositoryId: true, buyerId: true },
    });
    if (existingRow) {
      if (existingRow.buyerId !== buyerId) {
        throw new ForbiddenException('This transaction belongs to another buyer');
      }
      return this.purchaseRepository(buyerId, existingRow.repositoryId, txHash);
    }

    // Fetch the tx from chain so we know the recipient + value. The
    // previous build silently fell back to null on any RPC glitch and
    // surfaced a misleading "Transaction not found on Base" — even for
    // txs that plainly exist on Basescan. Try each candidate RPC in
    // sequence and surface the last error so we can debug when it fails.
    const configuredRpc = this.config.get<string>('ETH_RPC_URL', '');
    const candidateRpcs = [
      configuredRpc,
      'https://mainnet.base.org',
      'https://base.publicnode.com',
      'https://base.llamarpc.com',
    ].filter((url, i, arr) => url && arr.indexOf(url) === i);

    let tx: ethers.TransactionResponse | null = null;
    let receipt: ethers.TransactionReceipt | null = null;
    let lastError: string | null = null;
    for (const rpcUrl of candidateRpcs) {
      try {
        const provider = new ethers.JsonRpcProvider(rpcUrl);
        const [t, r] = await Promise.all([
          provider.getTransaction(txHash),
          provider.getTransactionReceipt(txHash),
        ]);
        if (t && r) {
          tx = t;
          receipt = r;
          break;
        }
        if (!lastError) {
          lastError = `RPC ${rpcUrl}: tx=${t ? 'ok' : 'null'} receipt=${r ? 'ok' : 'null'}`;
        }
      } catch (err) {
        lastError = `RPC ${rpcUrl}: ${err instanceof Error ? err.message : String(err)}`;
        this.logger.warn(`recover-purchase RPC ${rpcUrl} failed: ${lastError}`);
      }
    }
    if (!tx || !receipt) {
      this.logger.error(
        `recover-purchase: no RPC returned tx+receipt for ${txHash}. Last error: ${lastError}`,
      );
      throw new BadRequestException(
        `Could not fetch transaction from Base RPC. Last error: ${lastError ?? 'unknown'}. Make sure the hash is exactly the 0x… string from Basescan.`,
      );
    }
    if (receipt.status !== 1) {
      throw new BadRequestException('Transaction reverted on-chain');
    }

    // Determine the recipient wallet: ETH = tx.to, BOLTY = Transfer log `to`.
    const recipients = new Set<string>();
    if (tx.to && tx.value && BigInt(tx.value) > 0n) {
      recipients.add(tx.to.toLowerCase());
    }
    const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
    for (const log of receipt.logs) {
      if (log.topics[0] === TRANSFER_TOPIC && log.topics[2]) {
        recipients.add('0x' + log.topics[2].slice(26).toLowerCase());
      }
    }
    if (recipients.size === 0) {
      throw new BadRequestException(
        'This transaction does not transfer ETH or BOLTY to any address — cannot match it to a repo',
      );
    }

    // Find seller users with those wallets.
    const sellerCandidates = await this.prisma.user.findMany({
      where: {
        walletAddress: {
          in: Array.from(recipients).map((r) => r.toLowerCase()),
          mode: 'insensitive',
        },
        ...(sellerUsername
          ? { username: { equals: sellerUsername.replace(/^@/, ''), mode: 'insensitive' } }
          : {}),
      },
      select: { id: true, username: true, walletAddress: true },
    });
    if (sellerCandidates.length === 0) {
      throw new BadRequestException(
        sellerUsername
          ? `@${sellerUsername} has no wallet matching this transaction. Make sure the username is correct.`
          : 'No seller wallet on Bolty matches this transaction. Pass the seller username to help match.',
      );
    }

    // For each candidate seller, list their locked repos the buyer does
    // not already own a verified purchase of.
    const sellerIds = sellerCandidates.map((s) => s.id);
    const lockedRepos = await this.prisma.repository.findMany({
      where: {
        userId: { in: sellerIds },
        isLocked: true,
        lockedPriceUsd: { gt: 0 },
      },
      select: { id: true, name: true, lockedPriceUsd: true, userId: true },
    });

    const existingVerified = await this.prisma.repoPurchase.findMany({
      where: {
        buyerId,
        verified: true,
        repositoryId: { in: lockedRepos.map((r) => r.id) },
      },
      select: { repositoryId: true },
    });
    const ownedRepoIds = new Set(existingVerified.map((p) => p.repositoryId));
    const candidates = lockedRepos.filter((r) => !ownedRepoIds.has(r.id));

    if (candidates.length === 0) {
      throw new BadRequestException(
        'No matching locked repo found for this seller. If this looks wrong, ask the seller to confirm their wallet address on /profile.',
      );
    }
    if (candidates.length === 1) {
      return this.purchaseRepository(buyerId, candidates[0].id, txHash);
    }

    // Multiple candidates — disambiguate with the paid amount against the
    // live oracle. Use the same slippage band the downstream purchase
    // flow enforces (ETH 93% seller / BOLTY 97% seller minus 5% oracle
    // drift) instead of the previous loose 85% band, so the selected
    // repo always also passes `purchaseRepository` verification.
    const ethPrice = await this.chart.getEthPrice().catch(() => null);
    const sellerWalletsLc = new Set(
      sellerCandidates
        .map((s) => s.walletAddress)
        .filter((w): w is string => !!w)
        .map((w) => w.toLowerCase()),
    );
    const boltyContract = this.config.get<string>('BOLTY_TOKEN_CONTRACT', '');
    let paidWei: bigint = 0n;
    let isBoltyPath = false;
    if (tx.value && BigInt(tx.value) > 0n) {
      paidWei = BigInt(tx.value);
    } else if (boltyContract) {
      isBoltyPath = true;
      // BOLTY path: only count Transfer logs emitted by the configured
      // BOLTY contract whose `to` topic is one of the seller candidate
      // wallets. This prevents unrelated ERC-20 transfers in the same tx
      // from inflating `paidWei` during disambiguation.
      for (const log of receipt.logs) {
        if (log.address.toLowerCase() !== boltyContract.toLowerCase()) continue;
        if (log.topics[0] !== TRANSFER_TOPIC) continue;
        if (!log.topics[2]) continue;
        const to = '0x' + log.topics[2].slice(26).toLowerCase();
        if (!sellerWalletsLc.has(to)) continue;
        paidWei += BigInt(log.data);
      }
    }
    if (ethPrice && ethPrice.price > 0) {
      const feeBps = isBoltyPath ? 300n : 700n;
      const matching = candidates.filter((r) => {
        const expectedEth = (r.lockedPriceUsd ?? 0) / ethPrice.price;
        // oracle drift window (5%) × fee split
        const expectedTotal = BigInt(Math.floor(expectedEth * 0.95 * 1e18));
        const expectedSeller = (expectedTotal * (10000n - feeBps)) / 10000n;
        return paidWei >= expectedSeller;
      });
      if (matching.length === 1) {
        return this.purchaseRepository(buyerId, matching[0].id, txHash);
      }
    }
    throw new BadRequestException(
      `Multiple locked repos matched. Candidates: ${candidates
        .map((c) => c.name)
        .join(', ')}. Run /repos/:id/verify directly on the exact repo.`,
    );
  }

  async purchaseRepository(
    buyerId: string,
    repoId: string,
    txHash: string,
    platformFeeTxHash?: string,
    consentSignature?: string,
    consentMessage?: string,
  ) {
    const repo = await this.prisma.repository.findUnique({
      where: { id: repoId },
      include: { user: { select: { id: true, walletAddress: true } } },
    });

    if (!repo) throw new NotFoundException('Repository not found');
    if (!repo.isLocked) throw new BadRequestException('Repository is not locked');
    if (repo.userId === buyerId)
      throw new ForbiddenException('Cannot purchase your own repository');

    // Check if already purchased. Blocks BOTH verified rows (completed
    // purchase) and unverified ones (pending payment) to prevent the
    // double-pay scenario where a buyer with a stuck pending row sends
    // a second on-chain tx and loses the ETH.
    const existing = await this.prisma.repoPurchase.findFirst({
      where: { buyerId, repositoryId: repoId, txHash: { not: txHash } },
      select: { id: true, verified: true, txHash: true },
    });
    if (existing) {
      throw new ConflictException(
        existing.verified
          ? 'Already purchased — check your inventory'
          : 'You already have a pending payment on this repo. Use /inventory → Recover to resolve it.',
      );
    }

    const sellerWallet = repo.user.walletAddress;
    if (!sellerWallet) {
      throw new BadRequestException('Seller has no wallet address configured');
    }

    if (!(repo.lockedPriceUsd && repo.lockedPriceUsd > 0)) {
      throw new BadRequestException('Repository price is not set');
    }

    // ── Persist the attempt FIRST ────────────────────────────────────────
    // Guarantee a row exists for this txHash so the buyer's payment is
    // always captured — even if the on-chain verification below fails or
    // times out. A stuck verification must never make a confirmed payment
    // vanish from the buyer's library / orders.
    const pending = await this.prisma.repoPurchase.upsert({
      where: { txHash },
      create: {
        txHash,
        buyerId,
        repositoryId: repoId,
        amountWei: '0',
        verified: false,
        platformFeeTxHash: platformFeeTxHash || null,
        consentSignature: consentSignature || null,
        consentMessage: consentMessage || null,
      },
      update: {},
    });
    // If this txHash was submitted by a different buyer or for a different
    // repo, refuse — the unique txHash is one-to-one with a payment.
    if (pending.buyerId !== buyerId || pending.repositoryId !== repoId) {
      throw new BadRequestException('Transaction hash already linked to another purchase');
    }
    // If we already verified this exact tx (retry after success), short-circuit.
    if (pending.verified) {
      return {
        success: true,
        purchaseId: pending.id,
        downloadUrl: repo.githubUrl + '/archive/refs/heads/main.zip',
      };
    }

    // ── Expected payment amount ──────────────────────────────────────────
    // Repo prices are quoted in USD (`lockedPriceUsd`). Convert to wei via
    // the live ETH/USD oracle so an attacker can't pay dust for a $1k repo.
    const ethPrice = await this.chart.getEthPrice().catch(() => null);
    if (!ethPrice || !(ethPrice.price > 0)) {
      throw new BadRequestException('Price oracle unavailable, try again shortly');
    }
    // Allow 5% slippage between quote and confirmation — ETH can move a
    // couple percent while MetaMask is open and the old 3% window was
    // rejecting real payments after tiny oracle drifts.
    const minEth = (repo.lockedPriceUsd / ethPrice.price) * 0.95;
    let expectedTotalWei: bigint;
    try {
      expectedTotalWei = ethers.parseEther(minEth.toFixed(18));
    } catch {
      throw new BadRequestException('Repository price is not representable on-chain');
    }
    // Base network dual-fee model:
    //   - ETH payment   → 7% platform fee (93% to seller).
    //   - BOLTY payment → 3% platform fee (97% to seller; we incentivize BOLTY).
    const tokenContractCfg = this.config.get<string>('BOLTY_TOKEN_CONTRACT', '');
    const isBoltyPath = !!tokenContractCfg;
    const feeBps = isBoltyPath ? 300n : 700n;
    const expectedSellerWei = (expectedTotalWei * (10000n - feeBps)) / 10000n;
    const expectedPlatformFeeWei = (expectedTotalWei * feeBps) / 10000n;

    // ── Consent signature verification ────────────────────────────────────
    if (consentSignature && consentMessage) {
      try {
        const signerAddress = ethers.verifyMessage(consentMessage, consentSignature);
        const buyer = await this.prisma.user.findUnique({
          where: { id: buyerId },
          select: { walletAddress: true },
        });
        if (
          !buyer?.walletAddress ||
          signerAddress.toLowerCase() !== buyer.walletAddress.toLowerCase()
        ) {
          throw new BadRequestException('Consent signature does not match buyer wallet');
        }
      } catch (err) {
        if (err instanceof BadRequestException) throw err;
        throw new BadRequestException('Invalid consent signature');
      }
    }

    // ── On-chain verification (Base network, chainId 8453) ─────────────────
    // Auto-detect the payment path from the actual transaction rather than
    // trusting a config flag — if the buyer sent ETH directly to the seller,
    // verify the ETH transfer; if the tx carries zero ETH but emits an
    // ERC-20 Transfer to the seller from the configured BOLTY contract,
    // verify the token transfer. This avoids the old failure mode where
    // BOLTY_TOKEN_CONTRACT being set caused every ETH purchase to fail
    // with "No valid token transfer found".
    const tokenContract = tokenContractCfg;
    // Build an untyped provider handle for waitForReceipt's first argument
    // (it now ignores it and uses the RPC candidate list internally).
    const provider = new ethers.JsonRpcProvider(this.baseRpcCandidates()[0]);

    let amountWei = '0';
    let detectedCurrency: 'ETH' | 'BOLTY' = 'ETH';

    try {
      // Render web services time out connections after ~30s — wait up to 18s
      // for the receipt so the buyer gets a clear pending-retry response
      // rather than a dropped connection. The attempt is already persisted.
      const [receipt, tx] = await Promise.all([
        this.waitForReceipt(provider, txHash, 18_000),
        this.fetchBaseTx(txHash),
      ]);

      if (!receipt) {
        throw new BadRequestException(
          'Transaction is still pending — wait a few seconds and try again',
        );
      }
      if (receipt.status !== 1) {
        throw new BadRequestException('Transaction reverted on-chain');
      }

      // ── Payer identity check ──────────────────────────────────────────
      // Require the on-chain payer to be a wallet the authenticated buyer
      // has proven ownership of (primary walletAddress OR a linked
      // UserWallet). Without this, anyone watching Basescan could submit
      // someone else's tx hash to /purchase or /recover-purchase and
      // claim a verified row against the victim's payment.
      const buyerOwnedWallets = await this.buyerWallets(buyerId);
      if (buyerOwnedWallets.size === 0) {
        throw new ForbiddenException(
          'Link a wallet to your account before purchasing — we need to verify the payer',
        );
      }

      // Detect path: ETH if tx.value > 0 and routed to the seller; else BOLTY.
      const sentEth = tx && tx.value && BigInt(tx.value) > 0n;
      const sentToSeller = tx && tx.to && tx.to.toLowerCase() === sellerWallet.toLowerCase();

      if (sentEth && sentToSeller) {
        const payer = tx?.from?.toLowerCase();
        if (!payer || !buyerOwnedWallets.has(payer)) {
          throw new ForbiddenException(
            'Transaction was signed by a wallet that is not linked to your account',
          );
        }
        // ETH path: enforce ETH path slippage (93% of total after 7% fee).
        const ethPathSellerWei = (expectedTotalWei * (10000n - 700n)) / 10000n;
        if (BigInt(tx!.value) < ethPathSellerWei) {
          throw new BadRequestException(
            `Paid amount (${tx!.value.toString()} wei) is below expected price (${ethPathSellerWei.toString()} wei)`,
          );
        }
        amountWei = tx!.value.toString();
        detectedCurrency = 'ETH';
      } else if (tokenContract) {
        // BOLTY / ERC-20 path: require a Transfer(sender -> seller) log
        // whose `from` topic is a wallet owned by the authenticated buyer.
        const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
        const transferLog = receipt.logs.find((log) => {
          if (log.address.toLowerCase() !== tokenContract.toLowerCase()) return false;
          if (log.topics[0] !== TRANSFER_TOPIC) return false;
          if (!log.topics[1] || !log.topics[2]) return false;
          const logTo = '0x' + log.topics[2].slice(26).toLowerCase();
          if (logTo !== sellerWallet.toLowerCase()) return false;
          const logFrom = '0x' + log.topics[1].slice(26).toLowerCase();
          return buyerOwnedWallets.has(logFrom);
        });
        if (!transferLog) {
          // Distinguish "no transfer at all" from "transfer but wrong payer"
          // so buyers get an actionable error.
          const anyTransferToSeller = receipt.logs.find(
            (log) =>
              log.address.toLowerCase() === tokenContract.toLowerCase() &&
              log.topics[0] === TRANSFER_TOPIC &&
              log.topics[2] &&
              '0x' + log.topics[2].slice(26).toLowerCase() === sellerWallet.toLowerCase(),
          );
          if (anyTransferToSeller) {
            throw new ForbiddenException(
              'BOLTY transfer was sent from a wallet that is not linked to your account',
            );
          }
          throw new BadRequestException(
            'Payment did not reach the seller wallet (no ETH value and no BOLTY transfer)',
          );
        }
        const paid = BigInt(transferLog.data);
        const tokenPathSellerWei = (expectedTotalWei * (10000n - 300n)) / 10000n;
        if (paid < tokenPathSellerWei) {
          throw new BadRequestException(
            `Paid amount (${paid.toString()}) is below expected price (${tokenPathSellerWei.toString()})`,
          );
        }
        amountWei = paid.toString();
        detectedCurrency = 'BOLTY';
      } else {
        throw new BadRequestException('Transaction did not transfer funds to the seller wallet');
      }
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      this.logger.error(`Purchase verification error: ${err instanceof Error ? err.message : err}`);
      throw new BadRequestException('Could not verify transaction on-chain');
    }

    // ── Platform commission verification ──────────────────────────────────
    // Best-effort: if the buyer sent a platform fee tx, record it. Don't
    // block the purchase on a fee-amount mismatch — the seller payment is
    // what matters; platform accounting can be reconciled separately.
    // Still refuse if the fee tx exists but was sent to the wrong address.
    const platformWallet = this.config.get<string>('PLATFORM_WALLET', '');
    let platformFeeWei = '0';

    if (platformWallet && platformFeeTxHash) {
      try {
        const [feeReceipt, feeTx] = await Promise.all([
          this.waitForReceipt(provider, platformFeeTxHash, 18_000),
          this.fetchBaseTx(platformFeeTxHash),
        ]);

        if (feeReceipt && feeReceipt.status === 1 && feeTx) {
          if (feeTx.to?.toLowerCase() === platformWallet.toLowerCase()) {
            platformFeeWei = feeTx.value.toString();
          } else {
            this.logger.warn(
              `Platform fee tx ${platformFeeTxHash} sent to ${feeTx.to} instead of ${platformWallet} — recording as 0`,
            );
          }
        } else {
          this.logger.warn(
            `Platform fee tx ${platformFeeTxHash} not confirmed or missing — recording as 0`,
          );
        }
      } catch (err) {
        this.logger.warn(
          `Platform fee verification soft-failed: ${err instanceof Error ? err.message : err}`,
        );
      }
    }

    // Upgrade the pending row to verified.
    const purchase = await this.prisma.repoPurchase.update({
      where: { id: pending.id },
      data: {
        verified: true,
        amountWei,
        platformFeeWei: platformFeeWei || null,
      },
    });

    // Broadcast to the live market feed so the public trade ticker /
    // recent-sales panels pick it up alongside agent/listing purchases.
    try {
      const [buyerUser, sellerUser] = await Promise.all([
        this.prisma.user.findUnique({
          where: { id: buyerId },
          select: { id: true, username: true, avatarUrl: true },
        }),
        this.prisma.user.findUnique({
          where: { id: repo.userId },
          select: { id: true, username: true },
        }),
      ]);
      const eth = amountWei ? Number(amountWei) / 1e18 : null;
      this.marketGateway.emitSale({
        listingId: repo.id,
        listingTitle: repo.name,
        listingType: 'REPO',
        amountWei: amountWei ?? '0',
        priceEth: eth !== null && Number.isFinite(eth) ? Number(eth.toFixed(6)) : null,
        currency: detectedCurrency,
        buyer: buyerUser ?? { id: buyerId, username: null, avatarUrl: null },
        seller: sellerUser ?? { id: repo.userId, username: null },
        createdAt: purchase.createdAt.toISOString(),
      });
    } catch (err) {
      this.logger.warn(
        `Failed to broadcast repo sale event: ${err instanceof Error ? err.message : err}`,
      );
    }

    // Reputation: award BOTH seller and buyer for a confirmed repo sale.
    // Sellers get REPO_SOLD / FIRST_SALE; buyers get REPO_PURCHASED /
    // FIRST_PURCHASE. FIRST_* bonuses fire once per user across all
    // surfaces (market listings + repo purchases counted together).
    try {
      const [priorMarketSales, priorRepoSales, priorMarketBuys, priorRepoBuys] = await Promise.all([
        this.prisma.marketPurchase.count({
          where: { sellerId: repo.userId, verified: true },
        }),
        this.prisma.repoPurchase.count({
          where: { verified: true, repository: { userId: repo.userId }, id: { not: purchase.id } },
        }),
        this.prisma.marketPurchase.count({
          where: { buyerId, verified: true },
        }),
        this.prisma.repoPurchase.count({
          where: { buyerId, verified: true, id: { not: purchase.id } },
        }),
      ]);

      const sellerReason = priorMarketSales + priorRepoSales === 0 ? 'FIRST_SALE' : 'REPO_SOLD';
      this.reputation
        .awardPoints(repo.userId, sellerReason, purchase.id, repo.name)
        .catch((err) =>
          this.logger.warn(
            `Seller rays award failed for repo sale ${purchase.id}: ${err instanceof Error ? err.message : err}`,
          ),
        );

      const buyerReason =
        priorMarketBuys + priorRepoBuys === 0 ? 'FIRST_PURCHASE' : 'REPO_PURCHASED';
      this.reputation
        .awardPoints(buyerId, buyerReason, purchase.id, repo.name)
        .catch((err) =>
          this.logger.warn(
            `Buyer rays award failed for repo purchase ${purchase.id}: ${err instanceof Error ? err.message : err}`,
          ),
        );
    } catch (err) {
      this.logger.warn(
        `Reputation award skipped for repo sale ${purchase.id}: ${err instanceof Error ? err.message : err}`,
      );
    }

    // Purchase confirmation emails (fire-and-forget)
    (async () => {
      try {
        const parties = await this.prisma.user.findMany({
          where: { id: { in: [buyerId, repo.userId] } },
          select: {
            id: true,
            email: true,
            username: true,
            notificationPreference: { select: { emailOrderUpdates: true } },
          },
        });
        const buyerRec = parties.find((p) => p.id === buyerId);
        const sellerRec = parties.find((p) => p.id === repo.userId);
        const currency = isBoltyPath ? 'BOLTY' : 'ETH';
        const amount = amountWei ? Number(amountWei) / 1e18 : 0;
        const amountLabel =
          Number.isFinite(amount) && amount > 0
            ? `${amount.toFixed(6).replace(/0+$/, '').replace(/\.$/, '')} ${currency}`
            : `$${repo.lockedPriceUsd ?? 0}`;
        const payload = {
          buyerUsername: buyerRec?.username || 'buyer',
          sellerUsername: sellerRec?.username || 'seller',
          listingTitle: repo.name,
          orderId: purchase.id,
          amountLabel,
          txHash: purchase.txHash,
          purchaseKind: 'repo' as const,
        };
        const buyerOptIn = buyerRec?.notificationPreference?.emailOrderUpdates !== false;
        const sellerOptIn = sellerRec?.notificationPreference?.emailOrderUpdates !== false;
        if (buyerRec?.email && buyerOptIn) {
          await this.email.sendPurchaseConfirmation(buyerRec.email, 'buyer', payload);
        }
        if (sellerRec?.email && sellerOptIn) {
          await this.email.sendPurchaseConfirmation(sellerRec.email, 'seller', payload);
        }
      } catch (err) {
        this.logger.warn(
          `Repo purchase email failed for ${purchase.id}: ${err instanceof Error ? err.message : err}`,
        );
      }
    })();

    return {
      success: true,
      purchaseId: purchase.id,
      downloadUrl: repo.githubUrl + '/archive/refs/heads/main.zip',
    };
  }

  async checkPurchased(userId: string, repoId: string) {
    const purchase = await this.prisma.repoPurchase.findFirst({
      where: { buyerId: userId, repositoryId: repoId, verified: true },
    });
    return { purchased: !!purchase };
  }

  // ── Collaborators ──────────────────────────────────────────────────────────

  async getCollaborators(repoId: string) {
    const repo = await this.prisma.repository.findUnique({ where: { id: repoId } });
    if (!repo) throw new NotFoundException('Repository not found');

    return this.prisma.repoCollaborator.findMany({
      where: { repositoryId: repoId },
      include: {
        user: {
          select: {
            id: true,
            username: true,
            displayName: true,
            avatarUrl: true,
            reputationPoints: true,
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async addCollaborator(
    requestingUserId: string,
    repoId: string,
    data: { targetUserId?: string; name?: string; type?: string; url?: string; role?: string },
  ) {
    const repo = await this.prisma.repository.findUnique({ where: { id: repoId } });
    if (!repo) throw new NotFoundException('Repository not found');
    if (repo.userId !== requestingUserId) {
      throw new ForbiddenException('Only the repository owner can add collaborators');
    }

    const count = await this.prisma.repoCollaborator.count({ where: { repositoryId: repoId } });
    if (count >= 10) throw new BadRequestException('Maximum 10 collaborators per repository');

    const validTypes = ['USER', 'AI_AGENT', 'PROGRAM'];
    const type = data.type && validTypes.includes(data.type) ? data.type : 'USER';

    // If adding a user collaborator by ID, look them up
    if (data.targetUserId) {
      const targetUser = await this.prisma.user.findUnique({
        where: { id: data.targetUserId },
        select: { id: true, username: true, displayName: true },
      });
      if (!targetUser) throw new NotFoundException('User not found');
      if (targetUser.id === requestingUserId) {
        throw new BadRequestException('Cannot add yourself as a collaborator');
      }

      // Check unique constraint
      const exists = await this.prisma.repoCollaborator.findUnique({
        where: { repositoryId_userId: { repositoryId: repoId, userId: data.targetUserId } },
      });
      if (exists) throw new ConflictException('User is already a collaborator');

      const collaborator = await this.prisma.repoCollaborator.create({
        data: {
          repositoryId: repoId,
          userId: data.targetUserId,
          name: targetUser.displayName || targetUser.username || 'Unknown',
          type: 'USER',
          role: data.role?.slice(0, 80) || null,
          url: null,
        },
        include: {
          user: {
            select: {
              id: true,
              username: true,
              displayName: true,
              avatarUrl: true,
              reputationPoints: true,
            },
          },
        },
      });

      // Reward the collaborator for being added to a repo.
      this.reputation
        .awardPoints(data.targetUserId, 'COLLABORATOR_ADDED', repoId, repo.name)
        .catch((err) =>
          this.logger.warn(
            `Reputation award failed for collaborator ${data.targetUserId}: ${err instanceof Error ? err.message : err}`,
          ),
        );

      return collaborator;
    }

    // Non-user collaborator (AI_AGENT or PROGRAM)
    if (!data.name || data.name.trim().length < 2) {
      throw new BadRequestException('Collaborator name is required');
    }

    return this.prisma.repoCollaborator.create({
      data: {
        repositoryId: repoId,
        userId: null,
        name: data.name.slice(0, 80),
        type: type as unknown as any,
        role: data.role?.slice(0, 80) || null,
        url: data.url?.slice(0, 500) || null,
      },
    });
  }

  async removeCollaborator(requestingUserId: string, repoId: string, collaboratorId: string) {
    const repo = await this.prisma.repository.findUnique({ where: { id: repoId } });
    if (!repo) throw new NotFoundException('Repository not found');
    if (repo.userId !== requestingUserId) {
      throw new ForbiddenException('Only the repository owner can remove collaborators');
    }

    const collaborator = await this.prisma.repoCollaborator.findUnique({
      where: { id: collaboratorId },
    });
    if (!collaborator || collaborator.repositoryId !== repoId) {
      throw new NotFoundException('Collaborator not found');
    }

    await this.prisma.repoCollaborator.delete({ where: { id: collaboratorId } });
    return { success: true };
  }

  async deleteRepository(userId: string, repoId: string) {
    const repo = await this.prisma.repository.findUnique({ where: { id: repoId } });
    if (!repo) throw new NotFoundException('Repository not found');
    if (repo.userId !== userId) throw new ForbiddenException('Not your repository');
    await this.prisma.repository.delete({ where: { id: repoId } });
    return { success: true };
  }
}
