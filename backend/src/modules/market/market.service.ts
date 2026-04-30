import Anthropic from '@anthropic-ai/sdk';
import {
  Injectable,
  ForbiddenException,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { ethers } from 'ethers';

import { PrismaService } from '../../common/prisma/prisma.service';
import { RedisService } from '../../common/redis/redis.service';
import { sanitizeText, isSafeUrl, isSafeUrlResolving } from '../../common/sanitize/sanitize.util';
import { HagglGuardService } from '../hagglguard/hagglguard.service';
import { EmailService } from '../email/email.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ReputationService } from '../reputation/reputation.service';

import { MarketGateway } from './market.gateway';

interface CreateListingDto {
  title: string;
  description: string;
  type: 'REPO' | 'BOT' | 'SCRIPT' | 'AI_AGENT' | 'OTHER';
  price: number;
  currency?: string;
  minPrice?: number;
  tags?: string[];
  repositoryId?: string;
  agentUrl?: string;
  agentEndpoint?: string;
  /** One of webhook|mcp|openai|sandbox|hybrid|docker. Defaults to webhook
   *  for backward compatibility with rows created before this column
   *  existed. Validated server-side against the allow-list. */
  agentProtocol?: string;
  /** OpenAI-compatible only — model id (e.g. gpt-4o-mini). */
  agentModel?: string;
  /** OpenAI-compatible only — bearer token forwarded as Authorization. */
  agentApiKey?: string;
  fileKey?: string;
  fileName?: string;
  fileSize?: number;
  fileMimeType?: string;
}

@Injectable()
export class MarketService {
  private readonly logger = new Logger(MarketService.name);
  private readonly anthropic: Anthropic;
  // Per-process throttle for the PENDING_REVIEW self-heal write.
  // Runs at most once per 5 min across this instance — Redis handles
  // cross-instance dedup when needed. Avoids a DB write on every page load.
  private selfHealAt = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly notifications: NotificationsService,
    private readonly gateway: MarketGateway,
    private readonly reputation: ReputationService,
    private readonly email: EmailService,
    private readonly redis: RedisService,
    private readonly  hagglGuard: HagglGuardService,
  ) {
    this.anthropic = new Anthropic({
      apiKey: this.config.get<string>('ANTHROPIC_API_KEY') || '',
    });
  }

  // ── 24h activity cache ────────────────────────────────────────────────────
  // Recomputed lazily on each getListings call. Cheap enough (one groupBy).

  private async compute24hStats(
    listingIds: string[],
  ): Promise<Map<string, { sales24h: number; volumeEth24h: number }>> {
    const result = new Map<string, { sales24h: number; volumeEth24h: number }>();
    if (listingIds.length === 0) return result;

    const cacheKey = `market:24hstats:${listingIds.sort().join(',')}`;
    const cached = await this.redis.get(cacheKey).catch(() => null);
    if (cached) {
      const parsed = JSON.parse(cached) as [string, { sales24h: number; volumeEth24h: number }][];
      return new Map(parsed);
    }

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const rows = await this.prisma.marketPurchase.findMany({
      where: { listingId: { in: listingIds }, createdAt: { gte: since } },
      select: { listingId: true, amountWei: true },
    });

    for (const row of rows) {
      const prev = result.get(row.listingId) ?? { sales24h: 0, volumeEth24h: 0 };
      const amount = row.amountWei ? Number(row.amountWei) / 1e18 : 0;
      result.set(row.listingId, {
        sales24h: prev.sales24h + 1,
        volumeEth24h: prev.volumeEth24h + (Number.isFinite(amount) ? amount : 0),
      });
    }

    await this.redis.set(cacheKey, JSON.stringify([...result]), 300).catch(() => null);
    return result;
  }

  private async compute7dSparklines(listingIds: string[]): Promise<Map<string, number[]>> {
    const result = new Map<string, number[]>();
    if (listingIds.length === 0) return result;

    const cacheKey = `market:sparklines:${listingIds.sort().join(',')}`;
    const cached = await this.redis.get(cacheKey).catch(() => null);
    if (cached) {
      const parsed = JSON.parse(cached) as [string, number[]][];
      return new Map(parsed);
    }

    const now = Date.now();
    const since = new Date(now - 7 * 24 * 60 * 60 * 1000);
    const rows = await this.prisma.marketPurchase.findMany({
      where: { listingId: { in: listingIds }, createdAt: { gte: since } },
      select: { listingId: true, createdAt: true },
    });

    // 7 daily buckets for each listing
    for (const id of listingIds) result.set(id, new Array(7).fill(0));
    for (const row of rows) {
      const bucket = Math.min(
        6,
        Math.floor((now - row.createdAt.getTime()) / (24 * 60 * 60 * 1000)),
      );
      const idx = 6 - bucket;
      const arr = result.get(row.listingId);
      if (arr) arr[idx] += 1;
    }

    await this.redis.set(cacheKey, JSON.stringify([...result]), 300).catch(() => null);
    return result;
  }

  private async attachActivityStats<T extends { id: string }>(listings: T[]) {
    if (listings.length === 0) return listings;
    const map = await this.computeActivityMap(listings.map((l) => l.id));
    return this.mergeActivityStats(listings, map);
  }

  private async computeActivityMap(ids: string[]) {
    if (ids.length === 0) {
      return {
        stats24h: new Map<string, { sales24h: number; volumeEth24h: number }>(),
        spark: new Map<string, number[]>(),
      };
    }
    const [stats24h, spark] = await Promise.all([
      this.compute24hStats(ids),
      this.compute7dSparklines(ids),
    ]);
    return { stats24h, spark };
  }

  private mergeActivityStats<T extends { id: string }>(
    listings: T[],
    map: {
      stats24h: Map<string, { sales24h: number; volumeEth24h: number }>;
      spark: Map<string, number[]>;
    },
  ) {
    return listings.map((l) => {
      const s = map.stats24h.get(l.id) ?? { sales24h: 0, volumeEth24h: 0 };
      return {
        ...l,
        sales24h: s.sales24h,
        volumeEth24h: Number(s.volumeEth24h.toFixed(4)),
        sparkline7d: map.spark.get(l.id) ?? new Array(7).fill(0),
      };
    });
  }

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
   * Two-tier Claude security scan:
   *  Tier 1 — Haiku: fast initial analysis
   *  Tier 2 — Sonnet: deep analysis only when Haiku flags something suspicious
   */
  async scanContent(
    title: string,
    description: string,
  ): Promise<{ safe: boolean; reason: string; scanned: boolean }> {
    const basePrompt = `You are a content safety moderator for a developer marketplace.
Analyze the following listing and determine if it is safe and legitimate.

REJECT if it contains:
- Malware, spyware, ransomware, trojans, keyloggers
- Phishing tools, credential stealers
- DDoS / network attack tools
- Crypto drainers or wallet stealers
- Illegal hacking tools or exploits for production systems
- Scams or fraudulent services
- Adult or illegal content

ACCEPT if it is:
- A legitimate code repository, bot, or script
- A developer tool, automation script, or utility
- Trading bots, monitoring tools, analytics

Title: ${title.slice(0, 200)}
Description: ${description.slice(0, 1000)}

Respond with ONLY a JSON object: {"safe": true|false, "reason": "one sentence explanation"}`;

    // If the API key isn't configured, skip the scan entirely and publish
    // as-is. Blocking every listing behind an unreachable scanner was the
    // root cause of "my agent never shows up" — the sensible failure mode
    // here is to mark the row as unscanned and let admin moderation catch
    // anything genuinely bad.
    const apiKey = this.config.get<string>('ANTHROPIC_API_KEY') || '';
    if (!apiKey) {
      this.logger.warn('ANTHROPIC_API_KEY missing — publishing listing without content scan');
      return { safe: true, reason: 'Scan skipped (scanner not configured)', scanned: false };
    }

    try {
      // ── Tier 1: Haiku — fast scan ──────────────────────────────────────────
      const haikuRes = await this.anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 256,
        messages: [{ role: 'user', content: basePrompt }],
      });
      const haikuText = (haikuRes.content[0] as { type: string; text: string }).text ?? '';
      const haikuResult = this.parseJson(haikuText);

      if (haikuResult?.safe) {
        return { safe: true, reason: haikuResult.reason, scanned: true };
      }

      // ── Tier 2: Sonnet — deep analysis when suspicious ─────────────────────
      this.logger.warn(`Haiku flagged listing "${title}" — escalating to Sonnet`);
      const sonnetRes = await this.anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 512,
        messages: [
          {
            role: 'user',
            content: `${basePrompt}

NOTE: A preliminary scan flagged this as potentially suspicious. Perform a thorough analysis before making a final decision.`,
          },
        ],
      });
      const sonnetText = (sonnetRes.content[0] as { type: string; text: string }).text ?? '';
      const sonnetResult = this.parseJson(sonnetText);
      if (sonnetResult) {
        return { ...sonnetResult, scanned: true };
      }
    } catch (err) {
      // Scanner outage (rate limit, network, bad key): fail OPEN for
      // availability. We'd rather publish a listing the admin has to
      // take down than silently hide every listing the platform
      // generates — the latter feels like the site is broken.
      this.logger.error('Content scan failed — publishing without scan', err);
      return { safe: true, reason: 'Scan unavailable', scanned: false };
    }
    // Parse failure on Sonnet — treat as needing review.
    return { safe: false, reason: 'Manual review required', scanned: true };
  }

  async createListing(sellerId: string, dto: CreateListingDto) {
    const title = sanitizeText(dto.title.trim().slice(0, 200));
    const description = sanitizeText(dto.description.trim().slice(0, 5000));

    if (title.length < 3) throw new ForbiddenException('Title too short');
    if (description.length < 10) throw new ForbiddenException('Description too short');
    if (dto.price < 0 || dto.price > 1_000_000) throw new ForbiddenException('Invalid price');
    if (
      dto.minPrice !== null &&
      dto.minPrice !== undefined &&
      (dto.minPrice < 0 || dto.minPrice > dto.price)
    ) {
      throw new ForbiddenException('Minimum price must be between 0 and asking price');
    }

    // SSRF protection: validate webhook and agent URLs point to safe external hosts
    if (dto.agentEndpoint && !isSafeUrl(dto.agentEndpoint)) {
      throw new ForbiddenException('Invalid agent endpoint URL');
    }
    if (dto.agentUrl && !isSafeUrl(dto.agentUrl)) {
      throw new ForbiddenException('Invalid agent URL');
    }
    // Validate agent protocol against the allow-list. Anything outside
    // the known set is rejected so the row can never disagree with the
    // backend dispatcher.
    const ALLOWED_PROTOCOLS = ['webhook', 'mcp', 'openai', 'sandbox', 'hybrid'] as const;
    const agentProtocol = (dto.agentProtocol ?? 'webhook') as (typeof ALLOWED_PROTOCOLS)[number];
    if (!ALLOWED_PROTOCOLS.includes(agentProtocol)) {
      throw new ForbiddenException(`Unsupported agent protocol: ${dto.agentProtocol}`);
    }
    // OpenAI-compatible needs a model id; reject upfront so we never
    // create a half-configured row that fails at first invocation.
    if (agentProtocol === 'openai' && !(dto.agentModel ?? '').trim()) {
      throw new ForbiddenException('OpenAI-compatible protocol requires a model id');
    }

    // Check seller is not banned
    const seller = await this.prisma.user.findUnique({
      where: { id: sellerId },
      select: { isBanned: true },
    });
    if (!seller || seller.isBanned) throw new ForbiddenException('Account restricted');

    // AI security scan
    const scan = await this.scanContent(title, description);

    const created = await this.prisma.marketListing.create({
      data: {
        title,
        description,
        type: dto.type,
        price: dto.price,
        currency: dto.currency || 'ETH',
        tags: (dto.tags || []).map((t) => sanitizeText(t.slice(0, 50))).slice(0, 10),
        sellerId,
        repositoryId: dto.repositoryId || null,
        agentUrl: dto.agentUrl ? dto.agentUrl.trim().slice(0, 500) : null,
        agentEndpoint: dto.agentEndpoint ? dto.agentEndpoint.trim().slice(0, 500) : null,
        agentProtocol,
        agentModel: dto.agentModel ? dto.agentModel.trim().slice(0, 80) : null,
        agentApiKey: dto.agentApiKey ? dto.agentApiKey.trim().slice(0, 256) : null,
        minPrice: dto.minPrice !== null && dto.minPrice !== undefined ? dto.minPrice : null,
        fileKey: dto.fileKey || null,
        fileName: dto.fileName ? sanitizeText(dto.fileName.slice(0, 255)) : null,
        fileSize: dto.fileSize || null,
        fileMimeType: dto.fileMimeType ? dto.fileMimeType.slice(0, 100) : null,
        // Publish every listing as ACTIVE so it's immediately discoverable in
        // the public feed. The scan result is retained on `scanNote` so a
        // human moderator can revisit flagged items — gating visibility
        // behind an opaque PENDING_REVIEW status was silently hiding
        // sellers' work and making the marketplace look empty.
        status: 'ACTIVE',
        scanPassed: scan.safe,
        scanNote: scan.reason,
      },
      include: { seller: { select: { id: true, username: true, avatarUrl: true } } },
    });

    // HagglGuard: kick off the deep scan in the background so publish
    // stays fast. The first /market/:id/security read after this
    // resolves picks up the persisted score. If the seller has no
    // file uploaded the scan no-ops with score=100.
    if (created.fileKey) {
      void this.hagglGuard
        .scanListing(created.id)
        .catch((err) => this.logger?.warn?.(`HagglGuard scan failed: ${err}`));
    }

    if (created.status === 'ACTIVE') {
      this.gateway.emitNewListing({
        listingId: created.id,
        title: created.title,
        type: created.type,
        price: created.price,
        currency: created.currency,
        tags: created.tags ?? [],
        seller: created.seller,
        createdAt: created.createdAt.toISOString(),
      });

      // Reputation: AI agents are worth more than generic listings because
      // they take more effort to publish (wiring an endpoint, API keys, etc.).
      const reason = created.type === 'AI_AGENT' ? 'AI_AGENT_PUBLISHED' : 'LISTING_PUBLISHED';
      this.reputation
        .awardPoints(sellerId, reason, created.id, created.title)
        .catch((err) =>
          this.logger.warn(
            `Reputation award failed for listing ${created.id}: ${err instanceof Error ? err.message : err}`,
          ),
        );
    }

    return created;
  }

  async getListings(params: {
    type?: string;
    search?: string;
    page?: number;
    sortBy?: 'recent' | 'trending' | 'price-low' | 'price-high';
    minPrice?: number;
    maxPrice?: number;
    tags?: string[];
    hasDemo?: boolean;
  }) {
    const page = Math.max(1, params.page || 1);
    const take = 20;
    const skip = (page - 1) * take;
    const sortBy = params.sortBy || 'recent';

    // Self-heal listings stranded in PENDING_REVIEW — throttled to once per
    // 5 min per process so it doesn't fire a DB write on every page load.
    if (Date.now() - this.selfHealAt > 300_000) {
      this.selfHealAt = Date.now();
      this.prisma.marketListing
        .updateMany({ where: { status: 'PENDING_REVIEW' }, data: { status: 'ACTIVE' } })
        .catch(() => {});
    }

    // Build Redis cache key from all params (skip for search queries — too many combos).
    const cacheKey = !params.search
      ? `market:listings:${params.type ?? 'ALL'}:${params.sortBy ?? 'recent'}:${page}:${params.minPrice ?? ''}:${params.maxPrice ?? ''}:${(params.tags ?? []).join(',')}`
      : null;
    if (cacheKey) {
      const hit = await this.redis.get(cacheKey).catch(() => null);
      if (hit)
        return JSON.parse(hit) as { data: object[]; total: number; page: number; pages: number };
    }

    const where: Record<string, unknown> = { status: 'ACTIVE' };
    if (params.type && params.type !== 'ALL') where.type = params.type;
    if (params.search) {
      where.OR = [
        { title: { contains: params.search, mode: 'insensitive' } },
        { description: { contains: params.search, mode: 'insensitive' } },
        { tags: { has: params.search.toLowerCase() } },
      ];
    }
    if (typeof params.minPrice === 'number' || typeof params.maxPrice === 'number') {
      const priceFilter: Record<string, number> = {};
      if (typeof params.minPrice === 'number') priceFilter.gte = params.minPrice;
      if (typeof params.maxPrice === 'number') priceFilter.lte = params.maxPrice;
      where.price = priceFilter;
    }
    if (params.tags && params.tags.length > 0) {
      where.tags = { hasSome: params.tags.map((t) => t.toLowerCase()) };
    }
    if (params.hasDemo) {
      where.agentEndpoint = { not: null };
    }
    // Hide AI_AGENT listings from public discovery until the seller has
    // both saved their X App credentials AND completed OAuth. Sellers
    // see their own incomplete listings via /market/my-listings; the
    // public market only shows fully-configured agents so a buyer never
    // lands on a card whose auto-tweet capability is half-built. We
    // gate on accessTokenEnc because that's the field that flips
    // non-null exactly when OAuth completes.
    // AI_AGENT is visible publicly when EITHER OAuth path completed:
    //  - OAuth 2.0 → accessTokenEnc not null
    //  - OAuth 1.0a (BYO 4 keys) → oauth1AccessTokenEnc not null
    where.OR = [
      { type: { not: 'AI_AGENT' } },
      {
        type: 'AI_AGENT',
        agentXConnection: {
          is: {
            OR: [{ accessTokenEnc: { not: null } }, { oauth1AccessTokenEnc: { not: null } }],
          },
        },
      },
    ];

    if (sortBy === 'trending') {
      const result = await this.getTrendingListings(where, page, take, skip);
      // Mirror the regular path's Redis write so trending also benefits
      // from the 30s server-side cache and the CacheWarmer cron. Without
      // this, every trending hit re-runs purchase/negotiation aggregations
      // even when the same response could be served from cache.
      if (cacheKey) {
        this.redis.set(cacheKey, JSON.stringify(result), 30).catch(() => null);
      }
      return result;
    }

    const orderBy =
      sortBy === 'price-low'
        ? { price: 'asc' as const }
        : sortBy === 'price-high'
          ? { price: 'desc' as const }
          : { createdAt: 'desc' as const };

    const [rawListings, total] = await Promise.all([
      this.prisma.marketListing.findMany({
        where,
        skip,
        take,
        orderBy,
        include: {
          seller: { select: { id: true, username: true, avatarUrl: true } },
          repository: { select: { id: true, name: true, githubUrl: true, language: true } },
          // Bake the latest HagglGuard scan into each row so the badge
          // on every card doesn't have to fire its own GET. Eliminates
          // the N-extra-requests-per-list-page waterfall that made
          // filter changes feel like a fresh page load. `findings` is
          // intentionally excluded — heavy JSON, only loaded on the
          // detail page where the user actually wants it.
          securityScans: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: {
              id: true,
              score: true,
              worstSeverity: true,
              summary: true,
              scanner: true,
              createdAt: true,
            },
          },
        },
      }),
      this.prisma.marketListing.count({ where }),
    ]);

    const [withReviews, activityMap] = await Promise.all([
      this.attachReviewStats(rawListings),
      this.computeActivityMap(rawListings.map((l) => l.id)),
    ]);
    const merged = this.mergeActivityStats(withReviews, activityMap);
    // Strip the raw webhook URL from the public payload — leak the
    // boolean presence only. The URL is only returned on the owner's
    // /market/my-listings response and on GET /market/:id for the
    // listing owner. Defensive — a bad row shape shouldn't break the
    // whole list.
    const data = merged.map((l) => {
      if (!l || typeof l !== 'object') return l;
      const row = l as Record<string, unknown>;
      const endpoint = row.agentEndpoint;
      const copy = { ...row } as Record<string, unknown>;
      delete copy.agentEndpoint;
      copy.hasAgentEndpoint = Boolean(endpoint);
      // Flatten the take-1 array into a single field so the FE can read
      // listing.latestScan directly. Drop the noisy plural `securityScans`
      // array to keep the payload tight. Match the public scan endpoint
      // shape (`scannedAt`, not `createdAt`) so consumers can swap the
      // two sources interchangeably.
      const scans = copy.securityScans as
        | Array<{ createdAt: Date | string; [k: string]: unknown }>
        | undefined;
      if (scans && scans.length > 0) {
        const { createdAt, ...rest } = scans[0]!;
        copy.latestScan = { ...rest, scannedAt: createdAt };
      } else {
        copy.latestScan = null;
      }
      delete copy.securityScans;
      return copy;
    });
    const result = { data, total, page, pages: Math.ceil(total / take) };
    if (cacheKey) {
      this.redis.set(cacheKey, JSON.stringify(result), 30).catch(() => null);
    }
    return result;
  }

  /**
   * Seller-scoped listing feed — returns every listing the caller owns,
   * regardless of status (ACTIVE, PENDING_REVIEW, …), so the "My agents"
   * tab can show freshly-published drafts that didn't clear the scan
   * yet. Hides REMOVED rows so soft-deleted listings don't clutter the UI.
   */
  async getMyListings(sellerId: string) {
    // Self-heal any legacy PENDING_REVIEW rows this seller owns — fires at
    // most once per 5 min (reuses the same process-level throttle as getListings).
    if (Date.now() - this.selfHealAt > 300_000) {
      this.selfHealAt = Date.now();
      this.prisma.marketListing
        .updateMany({ where: { sellerId, status: 'PENDING_REVIEW' }, data: { status: 'ACTIVE' } })
        .catch(() => {});
    }

    const rows = await this.prisma.marketListing.findMany({
      where: { sellerId, status: { not: 'REMOVED' } },
      orderBy: { createdAt: 'desc' },
      include: {
        seller: { select: { id: true, username: true, avatarUrl: true } },
        repository: { select: { id: true, name: true, githubUrl: true, language: true } },
      },
    });
    const withReviews = await this.attachReviewStats(rows);
    const data = await this.attachActivityStats(withReviews);
    return { data, total: data.length, page: 1, pages: 1 };
  }

  async getMarketPulse(limit = 15): Promise<unknown> {
    const now = Date.now();
    // Redis-backed cache — works across all Render instances. 20s TTL keeps
    // the homepage feeling live while cutting DB load by an order of magnitude.
    const pulseCacheKey = `market:pulse:${limit}`;
    const cached = await this.redis.get(pulseCacheKey).catch(() => null);
    if (cached) return JSON.parse(cached) as unknown;
    const since24h = new Date(now - 24 * 60 * 60 * 1000);

    // Pull data from BOTH surfaces — market listings (agents/bots/scripts)
    // and verified repo purchases — so the public /market pulse actually
    // reflects the whole economy. Previously this was listings-only, which
    // made every repo sale invisible in 24H VOLUME, ALL-TIME SALES, and
    // the LIVE TRADES feed.
    const [
      totalActive,
      listingSales24h,
      repoSales24h,
      recentListingTrades,
      recentRepoTrades,
      recentListings,
      uniqueListingBuyers24h,
      uniqueRepoBuyers24h,
      totalListings,
      totalListingSales,
      totalRepoSales,
    ] = await Promise.all([
      this.prisma.marketListing.count({ where: { status: 'ACTIVE' } }),
      this.prisma.marketPurchase.findMany({
        where: { createdAt: { gte: since24h }, verified: true },
        select: { amountWei: true },
      }),
      this.prisma.repoPurchase.findMany({
        where: { createdAt: { gte: since24h }, verified: true },
        select: { amountWei: true },
      }),
      this.prisma.marketPurchase.findMany({
        where: { verified: true },
        orderBy: { createdAt: 'desc' },
        take: limit,
        select: {
          id: true,
          createdAt: true,
          amountWei: true,
          buyer: { select: { id: true, username: true, avatarUrl: true } },
          seller: { select: { id: true, username: true } },
          listing: {
            select: { id: true, title: true, type: true, currency: true, price: true },
          },
        },
      }),
      this.prisma.repoPurchase.findMany({
        where: { verified: true },
        orderBy: { createdAt: 'desc' },
        take: limit,
        select: {
          id: true,
          createdAt: true,
          amountWei: true,
          buyer: { select: { id: true, username: true, avatarUrl: true } },
          repository: {
            select: {
              id: true,
              name: true,
              lockedPriceUsd: true,
              user: { select: { id: true, username: true } },
            },
          },
        },
      }),
      this.prisma.marketListing.findMany({
        where: { status: 'ACTIVE' },
        orderBy: { createdAt: 'desc' },
        take: limit,
        select: {
          id: true,
          title: true,
          type: true,
          price: true,
          currency: true,
          tags: true,
          createdAt: true,
          seller: { select: { id: true, username: true, avatarUrl: true } },
        },
      }),
      this.prisma.marketPurchase.findMany({
        where: { createdAt: { gte: since24h }, verified: true },
        select: { buyerId: true },
        distinct: ['buyerId'],
      }),
      this.prisma.repoPurchase.findMany({
        where: { createdAt: { gte: since24h }, verified: true },
        select: { buyerId: true },
        distinct: ['buyerId'],
      }),
      this.prisma.marketListing.count(),
      this.prisma.marketPurchase.count({ where: { verified: true } }),
      this.prisma.repoPurchase.count({ where: { verified: true } }),
    ]);

    const weiSum = (rows: { amountWei: string | null }[]) =>
      rows.reduce((acc, r) => {
        const v = r.amountWei ? Number(r.amountWei) / 1e18 : 0;
        return acc + (Number.isFinite(v) ? v : 0);
      }, 0);

    const volumeEth24h = weiSum(listingSales24h) + weiSum(repoSales24h);
    const sales24h = listingSales24h.length + repoSales24h.length;
    const traderIds = new Set([
      ...uniqueListingBuyers24h.map((r) => r.buyerId),
      ...uniqueRepoBuyers24h.map((r) => r.buyerId),
    ]);

    // Merge both trade streams into a single timeline, newest first.
    const trades = [
      ...recentListingTrades.map((t) => ({
        id: t.id,
        createdAt: t.createdAt,
        amountWei: t.amountWei ?? '0',
        priceEth: t.amountWei ? Number(t.amountWei) / 1e18 : null,
        buyer: t.buyer,
        seller: t.seller,
        listing: t.listing,
      })),
      ...recentRepoTrades
        .filter((t) => t.repository)
        .map((t) => ({
          id: t.id,
          createdAt: t.createdAt,
          amountWei: t.amountWei ?? '0',
          priceEth: t.amountWei ? Number(t.amountWei) / 1e18 : null,
          buyer: t.buyer,
          seller: t.repository!.user,
          listing: {
            id: t.repository!.id,
            title: t.repository!.name,
            type: 'REPO' as const,
            currency: 'USD',
            price: t.repository!.lockedPriceUsd ?? 0,
          },
        })),
    ]
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, limit);

    const payload = {
      stats: {
        activeListings: totalActive,
        totalListings,
        totalSales: totalListingSales + totalRepoSales,
        sales24h,
        volumeEth24h: Number(volumeEth24h.toFixed(4)),
        traders24h: traderIds.size,
      },
      recentTrades: trades,
      recentListings,
    };
    await this.redis.set(pulseCacheKey, JSON.stringify(payload), 20).catch(() => null);
    return payload;
  }

  async getListingFacets() {
    // Pull type counts + price range via SQL aggregates so the DB does the
    // heavy lifting. For tags (string[] column) we still sample rows, but cap
    // at 500 so catalog growth can't turn this into a full-table scan on
    // every marketplace page load.
    const [typeGroups, priceAgg, totalActive, sampledForTags] = await Promise.all([
      this.prisma.marketListing.groupBy({
        by: ['type'],
        where: { status: 'ACTIVE' },
        _count: { _all: true },
      }),
      this.prisma.marketListing.aggregate({
        where: { status: 'ACTIVE' },
        _min: { price: true },
        _max: { price: true },
      }),
      this.prisma.marketListing.count({ where: { status: 'ACTIVE' } }),
      this.prisma.marketListing.findMany({
        where: { status: 'ACTIVE' },
        select: { tags: true },
        orderBy: { createdAt: 'desc' },
        take: 500,
      }),
    ]);

    const tagCounts = new Map<string, number>();
    for (const l of sampledForTags) {
      for (const t of l.tags || []) {
        tagCounts.set(t, (tagCounts.get(t) || 0) + 1);
      }
    }
    const topTags = Array.from(tagCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([tag, count]) => ({ tag, count }));

    const types = typeGroups.map((g) => ({ type: g.type, count: g._count._all }));

    return {
      tags: topTags,
      types,
      priceRange: {
        min: priceAgg._min.price ?? 0,
        max: priceAgg._max.price ?? 0,
      },
      totalActive,
    };
  }

  private async attachReviewStats<T extends { id: string }>(listings: T[]) {
    if (listings.length === 0) return listings;

    const ids = listings.map((l) => l.id);
    const cacheKey = `market:reviews:${ids.sort().join(',')}`;
    const cached = await this.redis.get(cacheKey).catch(() => null);

    let byId: Map<string, { _avg: { rating: number | null }; _count: { _all: number } }>;
    if (cached) {
      byId = new Map(
        JSON.parse(cached) as [
          string,
          { _avg: { rating: number | null }; _count: { _all: number } },
        ][],
      );
    } else {
      const stats = await this.prisma.marketReview.groupBy({
        by: ['listingId'],
        where: { listingId: { in: ids } },
        _avg: { rating: true },
        _count: { _all: true },
      });
      byId = new Map(stats.map((s) => [s.listingId, s]));
      await this.redis.set(cacheKey, JSON.stringify([...byId]), 600).catch(() => null);
    }

    return listings.map((l) => {
      const s = byId.get(l.id);
      return {
        ...l,
        reviewAverage: s?._avg.rating ? Number(s._avg.rating.toFixed(2)) : null,
        reviewCount: s?._count._all ?? 0,
      };
    });
  }

  private async getTrendingListings(
    where: Record<string, unknown>,
    page: number,
    take: number,
    skip: number,
  ) {
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    // Score listings off purchase + negotiation activity in the last 7 days.
    // We resolve the top-scoring ids up front, then fetch ONLY those rows with
    // their relations. Previous impl fetched every listing in the where clause
    // (unbounded) and sorted in app memory — that turned /market into an N+1
    // table scan for anyone browsing trending.
    const CANDIDATE_CAP = 200; // hard cap on how many listings we score
    const [purchaseStats, negotiationStats, total] = await Promise.all([
      this.prisma.marketPurchase.groupBy({
        by: ['listingId'],
        where: { createdAt: { gte: since } },
        _count: { _all: true },
      }),
      this.prisma.agentNegotiation.groupBy({
        by: ['listingId'],
        where: { createdAt: { gte: since } },
        _count: { _all: true },
      }),
      this.prisma.marketListing.count({ where }),
    ]);

    const scores = new Map<string, number>();
    for (const p of purchaseStats) {
      scores.set(p.listingId, (scores.get(p.listingId) || 0) + p._count._all * 3);
    }
    for (const n of negotiationStats) {
      scores.set(n.listingId, (scores.get(n.listingId) || 0) + n._count._all * 1);
    }

    // Include listings that scored (7d activity) plus the most recent ones
    // as a fallback, so first-page trending isn't empty on a quiet week.
    const scoredIds = Array.from(scores.keys());
    const recentFill = await this.prisma.marketListing.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: CANDIDATE_CAP,
      select: { id: true, createdAt: true },
    });
    const candidateIds = new Set<string>([...scoredIds, ...recentFill.map((l) => l.id)]);

    const candidates = await this.prisma.marketListing.findMany({
      where: { ...where, id: { in: Array.from(candidateIds) } },
      include: {
        seller: { select: { id: true, username: true, avatarUrl: true } },
        repository: { select: { id: true, name: true, githubUrl: true, language: true } },
      },
    });

    const ranked = candidates
      .map((l) => ({ listing: l, score: scores.get(l.id) || 0 }))
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return b.listing.createdAt.getTime() - a.listing.createdAt.getTime();
      });

    const withReviews = await this.attachReviewStats(
      ranked.slice(skip, skip + take).map((r) => r.listing),
    );
    const data = await this.attachActivityStats(withReviews);

    return { data, total, page, pages: Math.ceil(total / take) };
  }

  async getListing(id: string) {
    const listing = await this.prisma.marketListing.findUnique({
      where: { id },
      include: {
        seller: { select: { id: true, username: true, avatarUrl: true, walletAddress: true } },
        repository: {
          select: { id: true, name: true, githubUrl: true, language: true, stars: true },
        },
        // Same trick as the list endpoint — ship the latest scan with
        // the listing so the detail page renders the badge from the
        // first response, no extra GET round-trip.
        securityScans: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: {
            id: true,
            score: true,
            worstSeverity: true,
            summary: true,
            scanner: true,
            createdAt: true,
          },
        },
      },
    });
    if (!listing || listing.status === 'REMOVED') throw new NotFoundException('Listing not found');
    const agg = await this.prisma.marketReview.aggregate({
      where: { listingId: id },
      _avg: { rating: true },
      _count: { _all: true },
    });
    const { securityScans, ...rest } = listing as typeof listing & {
      securityScans?: Array<{ createdAt: Date | string; [k: string]: unknown }>;
    };
    let latestScan: Record<string, unknown> | null = null;
    if (securityScans && securityScans.length > 0) {
      const { createdAt, ...sr } = securityScans[0]!;
      latestScan = { ...sr, scannedAt: createdAt };
    }
    return {
      ...rest,
      latestScan,
      reviewAverage: agg._avg.rating ? Number(agg._avg.rating.toFixed(2)) : null,
      reviewCount: agg._count._all,
    };
  }

  /** Bulk lookup. Same row shape as getListings (with latestScan baked
   *  in), but takes an explicit id list. Caller is the favorites /
   *  library "saved" tab — one round-trip instead of N. Skips REMOVED
   *  rows so soft-deleted favorites disappear from the list naturally
   *  without exploding. Empty input returns an empty array. */
  async getListingsByIds(ids: string[]) {
    if (ids.length === 0) return [];
    const rows = await this.prisma.marketListing.findMany({
      where: { id: { in: ids }, status: { not: 'REMOVED' } },
      include: {
        seller: { select: { id: true, username: true, avatarUrl: true } },
        repository: { select: { id: true, name: true, githubUrl: true, language: true } },
        securityScans: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: {
            id: true,
            score: true,
            worstSeverity: true,
            summary: true,
            scanner: true,
            createdAt: true,
          },
        },
      },
    });
    // Preserve the caller's order — the FE pages this drives expect
    // the response to come back in the order they passed (= the order
    // the user starred them). Default DB order is undefined.
    const byId = new Map(rows.map((r) => [r.id, r]));
    return ids
      .map((id) => byId.get(id))
      .filter((r): r is NonNullable<typeof r> => !!r)
      .map((row) => {
        const r = row as Record<string, unknown> & {
          agentEndpoint?: string | null;
          securityScans?: Array<{ createdAt: Date | string; [k: string]: unknown }>;
        };
        const copy = { ...r } as Record<string, unknown>;
        const endpoint = r.agentEndpoint;
        delete copy.agentEndpoint;
        copy.hasAgentEndpoint = Boolean(endpoint);
        const scans = r.securityScans;
        if (scans && scans.length > 0) {
          const { createdAt, ...rest } = scans[0]!;
          copy.latestScan = { ...rest, scannedAt: createdAt };
        } else {
          copy.latestScan = null;
        }
        delete copy.securityScans;
        return copy;
      });
  }

  async getListingByFileKey(fileKey: string) {
    return this.prisma.marketListing.findUnique({
      where: { fileKey },
      select: { id: true, fileName: true, fileMimeType: true },
    });
  }

  async getRelatedListings(id: string, limit = 6) {
    const src = await this.prisma.marketListing.findUnique({
      where: { id },
      select: { id: true, type: true, tags: true, sellerId: true },
    });
    if (!src) return [];

    const sameTypeTagged = await this.prisma.marketListing.findMany({
      where: {
        status: 'ACTIVE',
        id: { not: id },
        OR: [{ type: src.type, tags: { hasSome: src.tags } }, { type: src.type }],
      },
      take: limit * 2,
      orderBy: { createdAt: 'desc' },
      include: {
        seller: { select: { id: true, username: true, avatarUrl: true } },
      },
    });

    // Rank: tag overlap first, then same seller, then recency.
    const ranked = sameTypeTagged
      .map((l) => {
        const overlap = l.tags.filter((t) => src.tags.includes(t)).length;
        const sameSeller = l.sellerId === src.sellerId ? 1 : 0;
        return { l, score: overlap * 10 + sameSeller };
      })
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return b.l.createdAt.getTime() - a.l.createdAt.getTime();
      })
      .slice(0, limit)
      .map((r) => r.l);

    return this.attachReviewStats(ranked);
  }

  async invokeAgent(listingId: string, prompt: string): Promise<{ reply: string }> {
    const listing = await this.prisma.marketListing.findUnique({
      where: { id: listingId },
      select: { id: true, status: true, agentEndpoint: true },
    });
    if (!listing || listing.status === 'REMOVED') {
      throw new NotFoundException('Listing not found');
    }
    if (!listing.agentEndpoint || !isSafeUrl(listing.agentEndpoint)) {
      throw new BadRequestException('This listing has no live endpoint');
    }
    // DNS-resolve at request time to defeat rebinding / post-validation
    // DNS changes. The sync isSafeUrl check above can be passed by a
    // hostname that later resolves to 169.254.169.254 or RFC1918.
    const resolved = await isSafeUrlResolving(listing.agentEndpoint);
    if (!resolved.ok) {
      throw new BadRequestException('Agent endpoint resolves to a blocked host');
    }
    const cleanPrompt = String(prompt || '')
      .trim()
      .slice(0, 1000);
    if (!cleanPrompt) {
      throw new BadRequestException('Prompt required');
    }
    try {
      const resp = await axios.post(
        listing.agentEndpoint,
        { event: 'demo_invoke', prompt: cleanPrompt },
        {
          timeout: 10000,
          headers: {
            'Content-Type': 'application/json',
            'X-Haggl-Event': 'demo_invoke',
          },
          maxBodyLength: 8192,
          maxContentLength: 8192,
          // Refuse redirects — otherwise a redirect to 169.254.169.254
          // bypasses the pre-flight allowlist.
          maxRedirects: 0,
          validateStatus: (s) => s >= 200 && s < 300,
        },
      );
      const raw = resp.data;
      const reply =
        typeof raw === 'string' ? raw : String(raw?.reply ?? raw?.output ?? raw?.message ?? '');
      const trimmed = reply.trim();
      return { reply: trimmed ? trimmed.slice(0, 4000) : 'Agent responded with no content.' };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Demo invoke failed for ${listingId}: ${msg}`);
      throw new BadRequestException('Agent endpoint did not respond. Try again later.');
    }
  }

  async userHasPurchasedListing(listingId: string, buyerId: string): Promise<boolean> {
    const purchase = await this.prisma.marketPurchase.findFirst({
      where: { listingId, buyerId },
    });
    return !!purchase;
  }

  /**
   * Detailed version used by the "do I already own this?" check on
   * listing detail pages. Returns the orderId so the frontend can
   * deep-link to /orders/:id without a second round-trip.
   */
  async getPurchaseStatus(listingId: string, buyerId: string) {
    const purchase = await this.prisma.marketPurchase.findFirst({
      where: { listingId, buyerId },
      select: { id: true, status: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
    return {
      purchased: !!purchase,
      orderId: purchase?.id ?? null,
      status: purchase?.status ?? null,
      purchasedAt: purchase?.createdAt ?? null,
    };
  }

  async getSellerProfile(username: string) {
    const seller = await this.prisma.user.findFirst({
      where: { username },
      select: {
        id: true,
        username: true,
        avatarUrl: true,
        bio: true,
        githubLogin: true,
        walletAddress: true,
        twitterUrl: true,
        linkedinUrl: true,
        websiteUrl: true,
        createdAt: true,
      },
    });
    if (!seller) throw new NotFoundException('Seller not found');

    const [listings, salesCount, reviewAgg, recentReviews] = await Promise.all([
      this.prisma.marketListing.findMany({
        where: { sellerId: seller.id, status: 'ACTIVE' },
        orderBy: { createdAt: 'desc' },
        take: 30,
        include: {
          repository: { select: { id: true, name: true, githubUrl: true, language: true } },
        },
      }),
      this.prisma.marketPurchase.count({ where: { sellerId: seller.id } }),
      this.prisma.marketReview.aggregate({
        where: { listing: { sellerId: seller.id } },
        _avg: { rating: true },
        _count: { _all: true },
      }),
      this.prisma.marketReview.findMany({
        where: { listing: { sellerId: seller.id } },
        orderBy: { createdAt: 'desc' },
        take: 6,
        include: {
          author: { select: { id: true, username: true, avatarUrl: true } },
          listing: { select: { id: true, title: true } },
        },
      }),
    ]);

    const listingsWithStats = await this.attachReviewStats(listings);

    return {
      seller,
      listings: listingsWithStats,
      stats: {
        listings: listings.length,
        salesAllTime: salesCount,
        avgRating: reviewAgg._avg.rating ? Number(reviewAgg._avg.rating.toFixed(2)) : null,
        reviewCount: reviewAgg._count._all,
      },
      recentReviews,
    };
  }

  async getTopSellers(limit = 12) {
    const salesGroup = await this.prisma.marketPurchase.groupBy({
      by: ['sellerId'],
      _count: { _all: true },
      orderBy: { _count: { sellerId: 'desc' } },
      take: limit,
    });
    if (salesGroup.length === 0) return [];

    const sellerIds = salesGroup.map((s) => s.sellerId);
    const [sellers, reviewAggs, listingCounts] = await Promise.all([
      this.prisma.user.findMany({
        where: { id: { in: sellerIds } },
        select: {
          id: true,
          username: true,
          avatarUrl: true,
          bio: true,
          githubLogin: true,
          createdAt: true,
        },
      }),
      this.prisma.marketReview.groupBy({
        by: ['listingId'],
        where: { listing: { sellerId: { in: sellerIds } } },
        _avg: { rating: true },
        _count: { _all: true },
      }),
      this.prisma.marketListing.groupBy({
        by: ['sellerId'],
        where: { sellerId: { in: sellerIds }, status: 'ACTIVE' },
        _count: { _all: true },
      }),
    ]);

    const sellerReviews = await this.prisma.marketListing.findMany({
      where: { sellerId: { in: sellerIds } },
      select: { id: true, sellerId: true },
    });
    const listingToSeller = new Map(sellerReviews.map((l) => [l.id, l.sellerId]));
    const reviewBySeller = new Map<string, { sum: number; count: number }>();
    for (const r of reviewAggs) {
      const sellerId = listingToSeller.get(r.listingId);
      if (!sellerId) continue;
      const agg = reviewBySeller.get(sellerId) || { sum: 0, count: 0 };
      agg.sum += (r._avg.rating || 0) * r._count._all;
      agg.count += r._count._all;
      reviewBySeller.set(sellerId, agg);
    }
    const listingCountBySeller = new Map(listingCounts.map((l) => [l.sellerId, l._count._all]));
    const salesBySeller = new Map(salesGroup.map((s) => [s.sellerId, s._count._all]));
    const sellerById = new Map(sellers.map((s) => [s.id, s]));

    return sellerIds
      .map((id) => {
        const seller = sellerById.get(id);
        if (!seller) return null;
        const rev = reviewBySeller.get(id);
        const avg = rev && rev.count > 0 ? rev.sum / rev.count : null;
        return {
          ...seller,
          sales: salesBySeller.get(id) || 0,
          activeListings: listingCountBySeller.get(id) || 0,
          avgRating: avg !== null ? Number(avg.toFixed(2)) : null,
          reviewCount: rev?.count || 0,
        };
      })
      .filter((s): s is NonNullable<typeof s> => s !== null);
  }

  /**
   * Unified "inventory" view for a logged-in user: everything they have
   * published (repos + market listings) and everything they've bought
   * (repo purchases + market purchases). For purchases we surface the
   * seller and the blockchain tx hash so the buyer can prove the
   * purchase on Basescan. For published items we also attach the rays
   * earned from reputation events tied to each resource, so sellers can
   * see "+75 rays" next to the sale that triggered them.
   */
  async getMyInventory(userId: string) {
    const [publishedRepos, publishedListings, repoPurchases, marketPurchases, reputationEvents] =
      await Promise.all([
        this.prisma.repository.findMany({
          where: { userId },
          orderBy: { createdAt: 'desc' },
          take: 200,
          select: {
            id: true,
            name: true,
            fullName: true,
            description: true,
            language: true,
            stars: true,
            forks: true,
            downloadCount: true,
            githubUrl: true,
            topics: true,
            logoUrl: true,
            isPrivate: true,
            isLocked: true,
            lockedPriceUsd: true,
            createdAt: true,
          },
        }),
        this.prisma.marketListing.findMany({
          where: { sellerId: userId, status: { not: 'REMOVED' } },
          orderBy: { createdAt: 'desc' },
          take: 200,
          select: {
            id: true,
            title: true,
            type: true,
            price: true,
            currency: true,
            tags: true,
            status: true,
            createdAt: true,
          },
        }),
        this.prisma.repoPurchase.findMany({
          where: { buyerId: userId },
          orderBy: { createdAt: 'desc' },
          take: 200,
          include: {
            repository: {
              select: {
                id: true,
                name: true,
                fullName: true,
                githubUrl: true,
                logoUrl: true,
                user: {
                  select: {
                    id: true,
                    username: true,
                    displayName: true,
                    avatarUrl: true,
                  },
                },
              },
            },
          },
        }),
        this.prisma.marketPurchase.findMany({
          where: { buyerId: userId },
          orderBy: { createdAt: 'desc' },
          take: 200,
          include: {
            listing: {
              select: {
                id: true,
                title: true,
                type: true,
                price: true,
                currency: true,
              },
            },
            seller: {
              select: {
                id: true,
                username: true,
                displayName: true,
                avatarUrl: true,
              },
            },
          },
        }),
        this.prisma.reputationEvent.findMany({
          where: { userId },
          orderBy: { createdAt: 'desc' },
          take: 500,
          select: {
            id: true,
            createdAt: true,
            points: true,
            reason: true,
            resourceId: true,
            note: true,
          },
        }),
      ]);

    // Map rays → resourceId so each published item / sold item can show
    // the rays it generated.
    const raysByResource = new Map<string, number>();
    for (const ev of reputationEvents) {
      if (!ev.resourceId) continue;
      raysByResource.set(ev.resourceId, (raysByResource.get(ev.resourceId) || 0) + ev.points);
    }

    return {
      published: {
        repos: publishedRepos.map((r) => ({
          ...r,
          raysEarned: raysByResource.get(r.id) || 0,
        })),
        listings: publishedListings.map((l) => ({
          ...l,
          raysEarned: raysByResource.get(l.id) || 0,
        })),
      },
      purchased: {
        repos: repoPurchases
          .filter((rp) => rp.repository)
          .map((rp) => ({
            id: rp.id,
            purchasedAt: rp.createdAt,
            txHash: rp.txHash,
            amountWei: rp.amountWei,
            verified: rp.verified,
            repository: rp.repository,
            seller: rp.repository!.user,
          })),
        listings: marketPurchases
          .filter((mp) => mp.listing)
          .map((mp) => ({
            id: mp.id,
            purchasedAt: mp.createdAt,
            txHash: mp.txHash,
            amountWei: mp.amountWei,
            verified: mp.verified,
            status: mp.status,
            escrowStatus: mp.escrowStatus,
            listing: mp.listing,
            seller: mp.seller,
          })),
      },
      rays: {
        total: reputationEvents.reduce((sum, ev) => sum + ev.points, 0),
        recentEvents: reputationEvents.slice(0, 25),
      },
    };
  }

  async getMyLibrary(buyerId: string) {
    // Cache per-user 30 s. Library content only changes when the buyer
    // makes a new purchase or writes a review — both happen rarely
    // enough that 30 s staleness is invisible. The PRE-CACHE was the
    // single biggest reason `/market/library` felt sluggish on cold
    // navigation: 3 prisma queries (purchases, repo-purchases, reviews)
    // each ran fresh on every nav even though the user landed on the
    // same data 100 % of the time within a session.
    const cacheKey = `market:library:user:${buyerId}`;
    const cached = await this.redis.get(cacheKey).catch(() => null);
    if (cached) {
      try {
        return JSON.parse(cached);
      } catch {
        /* corrupt — fall through to recompute */
      }
    }
    const [purchases, repoPurchases] = await Promise.all([
      this.prisma.marketPurchase.findMany({
        where: { buyerId },
        orderBy: { createdAt: 'desc' },
        take: 200,
        include: {
          listing: {
            select: {
              id: true,
              title: true,
              type: true,
              price: true,
              currency: true,
              tags: true,
              agentUrl: true,
              agentEndpoint: true,
              fileKey: true,
              fileName: true,
              fileSize: true,
              fileMimeType: true,
              status: true,
              seller: { select: { id: true, username: true, avatarUrl: true } },
            },
          },
        },
      }),
      this.prisma.repoPurchase.findMany({
        where: { buyerId },
        orderBy: { createdAt: 'desc' },
        take: 200,
        include: {
          repository: {
            select: {
              id: true,
              name: true,
              fullName: true,
              description: true,
              topics: true,
              lockedPriceUsd: true,
              githubUrl: true,
              user: { select: { id: true, username: true, avatarUrl: true } },
            },
          },
        },
      }),
    ]);
    const listingIds = purchases.map((p) => p.listing?.id).filter((id): id is string => !!id);
    const myReviews =
      listingIds.length > 0
        ? await this.prisma.marketReview.findMany({
            where: { authorId: buyerId, listingId: { in: listingIds } },
            select: { listingId: true, rating: true },
          })
        : [];
    const reviewMap = new Map(myReviews.map((r) => [r.listingId, r.rating]));

    const marketItems = purchases.map((p) => ({
      orderId: p.id,
      purchasedAt: p.createdAt,
      status: p.status,
      escrowStatus: p.escrowStatus,
      // Actual paid amount on-chain (wei). The `listing.price` is just
      // the sticker quote; the buyer may have negotiated down. Use this
      // field for "total spent" rollups in the UI.
      amountWei: p.amountWei ?? '0',
      txHash: p.txHash,
      listing: p.listing,
      myRating: p.listing ? (reviewMap.get(p.listing.id) ?? null) : null,
    }));

    // Repo purchases are stored in a separate table but belong in the buyer's
    // library so they surface alongside agent/bot/script purchases.
    const repoItems = repoPurchases
      .filter((rp) => rp.repository)
      .map((rp) => {
        const r = rp.repository!;
        return {
          orderId: rp.id,
          purchasedAt: rp.createdAt,
          status: rp.verified ? 'COMPLETED' : 'PENDING_DELIVERY',
          escrowStatus: 'NONE',
          verified: rp.verified,
          amountWei: rp.amountWei ?? '0',
          txHash: rp.txHash,
          myRating: null as number | null,
          listing: {
            id: r.id,
            title: r.name,
            type: 'REPO' as const,
            price: r.lockedPriceUsd ?? 0,
            currency: 'USD',
            tags: r.topics || [],
            agentUrl: r.githubUrl,
            agentEndpoint: null,
            fileKey: null,
            fileName: null,
            fileSize: null,
            fileMimeType: null,
            status: 'ACTIVE',
            seller: r.user,
            repositoryId: r.id,
          },
        };
      });

    const result = [...marketItems, ...repoItems].sort(
      (a, b) => new Date(b.purchasedAt).getTime() - new Date(a.purchasedAt).getTime(),
    );
    await this.redis.set(cacheKey, JSON.stringify(result), 30).catch(() => null);
    return result;
  }

  // ── Reviews ────────────────────────────────────────────────────────────────

  async createReview(listingId: string, authorId: string, rating: number, content?: string | null) {
    const r = Math.round(Number(rating));
    if (!Number.isFinite(r) || r < 1 || r > 5) {
      throw new BadRequestException('Rating must be between 1 and 5');
    }
    const listing = await this.prisma.marketListing.findUnique({
      where: { id: listingId },
      select: { id: true, sellerId: true, status: true },
    });
    if (!listing || listing.status === 'REMOVED') {
      throw new NotFoundException('Listing not found');
    }
    if (listing.sellerId === authorId) {
      throw new BadRequestException('Sellers cannot review their own listing');
    }
    const hasPurchased = await this.userHasPurchasedListing(listingId, authorId);
    if (!hasPurchased) {
      throw new ForbiddenException('Only buyers can review a listing');
    }
    const cleanContent = content ? sanitizeText(content).slice(0, 2000) : null;

    const review = await this.prisma.marketReview.upsert({
      where: { listingId_authorId: { listingId, authorId } },
      create: { listingId, authorId, rating: r, content: cleanContent },
      update: { rating: r, content: cleanContent },
      include: {
        author: { select: { id: true, username: true, avatarUrl: true } },
        listing: { select: { id: true, title: true } },
      },
    });

    if (listing.sellerId !== authorId) {
      try {
        await this.notifications.create({
          userId: listing.sellerId,
          type: 'MARKET_NEW_REVIEW',
          title: `New ${r}-star review on "${review.listing.title}"`,
          body: cleanContent ? cleanContent.slice(0, 200) : null,
          url: `/market/agents/${listingId}`,
          meta: { listingId, rating: r, authorId },
        });
      } catch (err) {
        this.logger.warn(
          `Failed to emit review notification: ${err instanceof Error ? err.message : err}`,
        );
      }
    }

    return review;
  }

  async getReviews(listingId: string) {
    const [reviews, agg] = await Promise.all([
      this.prisma.marketReview.findMany({
        where: { listingId },
        orderBy: { createdAt: 'desc' },
        take: 50,
        include: {
          author: { select: { id: true, username: true, avatarUrl: true } },
        },
      }),
      this.prisma.marketReview.aggregate({
        where: { listingId },
        _avg: { rating: true },
        _count: { _all: true },
      }),
    ]);
    return {
      reviews,
      average: agg._avg.rating ? Number(agg._avg.rating.toFixed(2)) : null,
      count: agg._count._all,
    };
  }

  async deleteReview(reviewId: string, userId: string) {
    const review = await this.prisma.marketReview.findUnique({
      where: { id: reviewId },
      select: { id: true, authorId: true },
    });
    if (!review) throw new NotFoundException('Review not found');
    if (review.authorId !== userId) throw new ForbiddenException('Not your review');
    await this.prisma.marketReview.delete({ where: { id: reviewId } });
    return { ok: true };
  }

  // ── Seller analytics ──────────────────────────────────────────────────────

  async getSellerAnalytics(sellerId: string) {
    const since30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const since7 = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const listings = await this.prisma.marketListing.findMany({
      where: { sellerId, status: { not: 'REMOVED' } },
      select: {
        id: true,
        title: true,
        type: true,
        price: true,
        currency: true,
        status: true,
        createdAt: true,
        boostedUntil: true,
      },
      orderBy: { createdAt: 'desc' },
    });
    const listingIds = listings.map((l) => l.id);

    if (listingIds.length === 0) {
      return {
        totals: {
          listings: 0,
          activeListings: 0,
          salesAllTime: 0,
          salesLast30: 0,
          salesLast7: 0,
          revenueAllTime: 0,
          revenueLast30: 0,
          negotiationsOpenLast30: 0,
          avgRating: null as number | null,
          reviewCount: 0,
        },
        listings: [],
        recentSales: [],
        salesByDay: [],
      };
    }

    const [
      purchaseAllTime,
      purchaseLast30,
      purchaseLast7,
      negotiationStats,
      reviewAgg,
      reviewPerListing,
      salesPerListing,
      recentSales,
      salesRaw,
    ] = await Promise.all([
      this.prisma.marketPurchase.aggregate({
        where: { listingId: { in: listingIds } },
        _count: { _all: true },
      }),
      this.prisma.marketPurchase.findMany({
        where: { listingId: { in: listingIds }, createdAt: { gte: since30 } },
        select: { listingId: true, createdAt: true },
      }),
      this.prisma.marketPurchase.count({
        where: { listingId: { in: listingIds }, createdAt: { gte: since7 } },
      }),
      this.prisma.agentNegotiation.count({
        where: { listingId: { in: listingIds }, createdAt: { gte: since30 } },
      }),
      this.prisma.marketReview.aggregate({
        where: { listingId: { in: listingIds } },
        _avg: { rating: true },
        _count: { _all: true },
      }),
      this.prisma.marketReview.groupBy({
        by: ['listingId'],
        where: { listingId: { in: listingIds } },
        _avg: { rating: true },
        _count: { _all: true },
      }),
      this.prisma.marketPurchase.groupBy({
        by: ['listingId'],
        where: { listingId: { in: listingIds } },
        _count: { _all: true },
      }),
      this.prisma.marketPurchase.findMany({
        where: { listingId: { in: listingIds } },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: {
          id: true,
          createdAt: true,
          status: true,
          listing: { select: { id: true, title: true } },
          buyer: { select: { id: true, username: true, avatarUrl: true } },
        },
      }),
      this.prisma.marketPurchase.findMany({
        where: { listingId: { in: listingIds }, createdAt: { gte: since30 } },
        select: { createdAt: true, listingId: true },
      }),
    ]);

    // Revenue: sum price * sales count per listing (price captured on listing,
    // since amountWei may be 0 for legacy rows). Good enough for dashboard.
    const salesByListing = new Map<string, number>();
    for (const s of salesPerListing) salesByListing.set(s.listingId, s._count._all);
    const revenueAllTime = listings.reduce(
      (sum, l) => sum + (salesByListing.get(l.id) || 0) * (l.price || 0),
      0,
    );
    const last30ByListing = new Map<string, number>();
    for (const p of purchaseLast30) {
      last30ByListing.set(p.listingId, (last30ByListing.get(p.listingId) || 0) + 1);
    }
    const revenueLast30 = listings.reduce(
      (sum, l) => sum + (last30ByListing.get(l.id) || 0) * (l.price || 0),
      0,
    );

    const reviewByListing = new Map(reviewPerListing.map((r) => [r.listingId, r]));

    // Sales by day (last 30 days, ISO date key)
    const byDay = new Map<string, number>();
    for (let i = 29; i >= 0; i--) {
      const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
      byDay.set(d.toISOString().slice(0, 10), 0);
    }
    for (const s of salesRaw) {
      const key = s.createdAt.toISOString().slice(0, 10);
      if (byDay.has(key)) byDay.set(key, (byDay.get(key) || 0) + 1);
    }

    return {
      totals: {
        listings: listings.length,
        activeListings: listings.filter((l) => l.status === 'ACTIVE').length,
        salesAllTime: purchaseAllTime._count._all,
        salesLast30: purchaseLast30.length,
        salesLast7: purchaseLast7,
        revenueAllTime: Number(revenueAllTime.toFixed(4)),
        revenueLast30: Number(revenueLast30.toFixed(4)),
        negotiationsOpenLast30: negotiationStats,
        avgRating: reviewAgg._avg.rating ? Number(reviewAgg._avg.rating.toFixed(2)) : null,
        reviewCount: reviewAgg._count._all,
      },
      listings: listings.map((l) => {
        const r = reviewByListing.get(l.id);
        return {
          ...l,
          sales: salesByListing.get(l.id) || 0,
          revenue: Number(((salesByListing.get(l.id) || 0) * (l.price || 0)).toFixed(4)),
          reviewAverage: r?._avg.rating ? Number(r._avg.rating.toFixed(2)) : null,
          reviewCount: r?._count._all ?? 0,
        };
      }),
      recentSales,
      salesByDay: Array.from(byDay.entries()).map(([date, sales]) => ({ date, sales })),
    };
  }

  /**
   * Generic recovery for listing purchases — the user pastes only the
   * txHash and we figure out which seller + which listing it was for
   * by looking at the tx recipient on-chain. Matches the ergonomics of
   * the repo-recovery flow so /inventory's widget can serve both.
   */
  async recoverListingPurchaseByTx(buyerId: string, txHash: string) {
    if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
      throw new BadRequestException('Invalid transaction hash');
    }

    // Short-circuit: if we already have a row for this txHash, return it.
    const existing = await this.prisma.marketPurchase.findUnique({
      where: { txHash },
    });
    if (existing) {
      if (existing.buyerId !== buyerId) {
        throw new ForbiddenException('Transaction belongs to a different buyer');
      }
      return { success: true, alreadyPurchased: true, purchase: existing };
    }

    // Pull the tx from any working Base RPC.
    const configured = this.config.get<string>('ETH_RPC_URL', '');
    const candidates = [
      configured,
      'https://mainnet.base.org',
      'https://base.publicnode.com',
      'https://base.llamarpc.com',
    ].filter((url, i, arr) => url && arr.indexOf(url) === i);
    let tx: ethers.TransactionResponse | null = null;
    let lastErr: string | null = null;
    for (const rpc of candidates) {
      try {
        const provider = new ethers.JsonRpcProvider(rpc);
        const t = await provider.getTransaction(txHash);
        if (t) {
          tx = t;
          break;
        }
      } catch (err) {
        lastErr = `${rpc}: ${err instanceof Error ? err.message : String(err)}`;
      }
    }
    if (!tx || !tx.to) {
      throw new BadRequestException(
        `Could not fetch transaction from Base RPC. ${lastErr ?? ''}`.trim(),
      );
    }

    // Resolve the seller from tx.to (either the seller wallet directly
    // or the escrow contract; in the escrow case we need the negotiation
    // or the listing id to disambiguate — we ask the user to use the
    // per-listing endpoint instead).
    const sellerByWallet = await this.prisma.user.findFirst({
      where: {
        walletAddress: { equals: tx.to.toLowerCase(), mode: 'insensitive' },
      },
      select: { id: true, username: true },
    });
    if (!sellerByWallet) {
      throw new BadRequestException(
        'Could not match the tx recipient to a haggl seller wallet. If it went through escrow, open /orders and retry from there.',
      );
    }

    const paidWei = BigInt(tx.value);
    const listings = await this.prisma.marketListing.findMany({
      where: {
        sellerId: sellerByWallet.id,
        status: { not: 'REMOVED' },
      },
      select: { id: true, price: true, title: true },
    });
    if (listings.length === 0) {
      throw new BadRequestException(
        `@${sellerByWallet.username ?? 'seller'} has no active listings.`,
      );
    }

    // If the buyer has an AGREED negotiation with this seller, prefer
    // that listing — price has been pinned by agents and matches the tx.
    const agreed = await this.prisma.agentNegotiation.findFirst({
      where: {
        buyerId,
        status: 'AGREED',
        listing: { sellerId: sellerByWallet.id },
      },
      orderBy: { updatedAt: 'desc' },
      select: { listingId: true, id: true, agreedPrice: true },
    });
    if (agreed) {
      return this.recoverListingPurchase(buyerId, agreed.listingId, txHash, agreed.id);
    }

    // Otherwise try to match by paid amount within 5% slippage.
    const matching = listings.filter((l) => {
      try {
        const expected = ethers.parseEther(l.price.toString());
        const min = (expected * 95n) / 100n;
        return paidWei >= min;
      } catch {
        return false;
      }
    });
    if (matching.length === 1) {
      return this.recoverListingPurchase(buyerId, matching[0].id, txHash);
    }
    if (matching.length === 0) {
      throw new BadRequestException(
        `Paid ${(Number(paidWei) / 1e18).toFixed(6)} ETH but none of @${sellerByWallet.username ?? 'seller'}'s listings match that price.`,
      );
    }
    throw new BadRequestException(
      `Multiple listings from @${sellerByWallet.username ?? 'seller'} match this amount. Open the specific listing and retry purchase from there.`,
    );
  }

  /**
   * Recovery for listing purchases whose on-chain payment confirmed but
   * the /market/:id/purchase call never landed. Scoped to the buyer via
   * the existing duplicate-tx guard.
   */
  async recoverListingPurchase(
    buyerId: string,
    listingId: string,
    txHash: string,
    negotiationId?: string,
  ) {
    if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
      throw new BadRequestException('Invalid transaction hash');
    }
    // If we already have a row for this txHash we're done — return it.
    const existing = await this.prisma.marketPurchase.findUnique({
      where: { txHash },
    });
    if (existing) {
      if (existing.buyerId !== buyerId) {
        throw new ForbiddenException('Transaction belongs to a different buyer');
      }
      return { success: true, alreadyPurchased: true, purchase: existing };
    }
    // Kick the normal flow with a dummy amountWei ('0'); the verify
    // path reads the true amount from the receipt.
    return this.purchaseListing(listingId, buyerId, txHash, '0', negotiationId);
  }

  async claimFreeListing(listingId: string, buyerId: string) {
    const listing = await this.prisma.marketListing.findUnique({
      where: { id: listingId },
      include: { seller: { select: { id: true } } },
    });
    if (!listing || listing.status === 'REMOVED') throw new NotFoundException('Listing not found');
    if (listing.sellerId === buyerId) throw new ForbiddenException('Cannot claim your own listing');
    if (listing.price !== 0) throw new BadRequestException('Listing is not free');

    const existing = await this.prisma.marketPurchase.findFirst({ where: { listingId, buyerId } });
    if (existing) return { success: true, alreadyPurchased: true, purchase: existing };

    const purchase = await this.prisma.marketPurchase.create({
      data: {
        txHash: `free_${listingId}_${buyerId}_${Date.now()}`,
        amountWei: '0',
        verified: true,
        buyerId,
        sellerId: listing.sellerId,
        listingId,
        status: 'COMPLETED',
      },
    });

    this.notifications
      .create({
        userId: listing.sellerId,
        type: 'MARKET_NEW_SALE',
        title: 'Your free listing was claimed',
        url: `/market/agents/${listingId}`,
        meta: { listingId, purchaseId: purchase.id },
      })
      .catch(() => null);

    return { success: true, purchase };
  }

  async purchaseListing(
    listingId: string,
    buyerId: string,
    txHash: string,
    amountWei: string,
    negotiationId?: string,
    platformFeeTxHash?: string,
    consentSignature?: string,
    consentMessage?: string,
    escrowContract?: string,
  ) {
    const listing = await this.prisma.marketListing.findUnique({
      where: { id: listingId },
      include: { seller: { select: { id: true, walletAddress: true } } },
    });
    if (!listing || listing.status === 'REMOVED') throw new NotFoundException('Listing not found');
    if (listing.sellerId === buyerId)
      throw new ForbiddenException('Cannot purchase your own listing');

    // Check not already purchased
    const existing = await this.prisma.marketPurchase.findFirst({ where: { listingId, buyerId } });
    if (existing) return { success: true, alreadyPurchased: true, purchase: existing };

    // Check tx hash not duplicate
    const dupTx = await this.prisma.marketPurchase.findUnique({ where: { txHash } });
    if (dupTx) throw new ForbiddenException('Transaction already recorded');

    // ── Expected payment amount ──────────────────────────────────────────
    // If the buyer negotiated, honor the agreed price; otherwise the sticker
    // price. This is the value we check the on-chain tx against — without it
    // an attacker can pay 1 wei for a 10 ETH listing.
    let expectedPrice = listing.price;
    if (negotiationId) {
      const neg = await this.prisma.agentNegotiation.findUnique({
        where: { id: negotiationId },
        select: { buyerId: true, listingId: true, status: true, agreedPrice: true },
      });
      if (!neg || neg.buyerId !== buyerId || neg.listingId !== listingId) {
        throw new ForbiddenException('Negotiation does not match this purchase');
      }
      if (neg.status !== 'AGREED' || neg.agreedPrice == null) {
        throw new BadRequestException('Negotiation is not in AGREED state');
      }
      expectedPrice = neg.agreedPrice;
    }
    if (!(expectedPrice > 0)) {
      throw new BadRequestException('Listing price is not set');
    }
    let expectedWei: bigint;
    try {
      expectedWei = ethers.parseEther(expectedPrice.toString());
    } catch {
      throw new BadRequestException('Listing price is not representable on-chain');
    }

    const rpcUrl = this.config.get<string>('ETH_RPC_URL', 'https://mainnet.base.org');
    const platformWallet = this.config.get<string>('PLATFORM_WALLET', '');
    const configuredEscrow = this.config.get<string>('ESCROW_CONTRACT', '');
    const sellerWallet = listing.seller.walletAddress;

    if (!sellerWallet) {
      throw new BadRequestException('Seller has no wallet address configured');
    }

    // ── Consent signature verification ──────────────────────────────────
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

    const useEscrow = !!(escrowContract && configuredEscrow);
    let verifiedAmountWei = amountWei;
    let platformFeeWei = '0';

    try {
      // Base RPC candidate list: configured one first, then public
      // endpoints. Using a single RPC used to silently fail when
      // ETH_RPC_URL was misconfigured or rate-limited, surfacing as
      // "cannot verify transaction" even though the tx was fine.
      const candidates = [
        rpcUrl,
        'https://mainnet.base.org',
        'https://base.publicnode.com',
        'https://base.llamarpc.com',
      ].filter((url, i, arr) => url && arr.indexOf(url) === i);
      let receipt: ethers.TransactionReceipt | null = null;
      let tx: ethers.TransactionResponse | null = null;
      let lastErr: string | null = null;
      for (const candidate of candidates) {
        try {
          const provider = new ethers.JsonRpcProvider(candidate);
          const [r, t] = await Promise.all([
            provider.getTransactionReceipt(txHash),
            provider.getTransaction(txHash),
          ]);
          if (r && t) {
            receipt = r;
            tx = t;
            break;
          }
          if (!lastErr)
            lastErr = `RPC ${candidate}: receipt=${r ? 'ok' : 'null'} tx=${t ? 'ok' : 'null'}`;
        } catch (err) {
          lastErr = `RPC ${candidate}: ${err instanceof Error ? err.message : String(err)}`;
        }
      }
      if (!receipt || receipt.status !== 1) {
        throw new BadRequestException(
          `Transaction failed or not found. ${lastErr ? `Last RPC error: ${lastErr}` : ''}`,
        );
      }
      if (!tx) throw new BadRequestException('Transaction not found');

      if (useEscrow) {
        // ── Escrow mode: verify deposit was sent to the escrow contract ──
        if (escrowContract.toLowerCase() !== configuredEscrow.toLowerCase()) {
          throw new BadRequestException('Escrow contract address mismatch');
        }
        if (tx.to?.toLowerCase() !== escrowContract.toLowerCase()) {
          throw new BadRequestException('Transaction was not sent to escrow contract');
        }
        if (BigInt(tx.value) < expectedWei) {
          throw new BadRequestException(
            `Paid amount (${tx.value.toString()} wei) is below expected price (${expectedWei.toString()} wei)`,
          );
        }
        verifiedAmountWei = tx.value.toString();
      } else {
        // ── Legacy direct mode: verify payment to seller ─────────────────
        if (tx.to?.toLowerCase() !== sellerWallet.toLowerCase()) {
          throw new BadRequestException('Transaction recipient does not match seller wallet');
        }
        if (BigInt(tx.value) < expectedWei) {
          throw new BadRequestException(
            `Paid amount (${tx.value.toString()} wei) is below expected price (${expectedWei.toString()} wei)`,
          );
        }
        verifiedAmountWei = tx.value.toString();

        // Verify platform commission (legacy only — escrow handles split automatically)
        if (platformWallet && platformFeeTxHash) {
          try {
            const feeProvider = new ethers.JsonRpcProvider(candidates[0]);
            const [feeReceipt, feeTx] = await Promise.all([
              feeProvider.getTransactionReceipt(platformFeeTxHash),
              feeProvider.getTransaction(platformFeeTxHash),
            ]);
            if (!feeReceipt || feeReceipt.status !== 1) {
              throw new BadRequestException('Platform fee transaction failed or not found');
            }
            if (!feeTx || feeTx.to?.toLowerCase() !== platformWallet.toLowerCase()) {
              throw new BadRequestException('Platform fee recipient does not match haggl wallet');
            }
            platformFeeWei = feeTx.value.toString();
          } catch (err) {
            if (err instanceof BadRequestException) throw err;
            this.logger.error(
              `Platform fee verification error: ${err instanceof Error ? err.message : err}`,
            );
            throw new BadRequestException('Could not verify platform fee transaction');
          }
        }
      }
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      this.logger.error(`Tx verification error: ${err instanceof Error ? err.message : err}`);
      throw new BadRequestException('Could not verify transaction on-chain');
    }

    let purchase;
    try {
      purchase = await this.prisma.marketPurchase.create({
        data: {
          txHash,
          amountWei: verifiedAmountWei,
          buyerId,
          sellerId: listing.sellerId,
          listingId,
          negotiationId: negotiationId || null,
          verified: true,
          status: 'PENDING_DELIVERY',
          platformFeeTxHash: useEscrow ? null : platformFeeTxHash || null,
          platformFeeWei: useEscrow ? null : platformFeeWei || null,
          consentSignature: consentSignature || null,
          consentMessage: consentMessage || null,
          escrowContract: useEscrow ? escrowContract : null,
          escrowStatus: useEscrow ? 'FUNDED' : 'NONE',
        },
      });
    } catch (err: unknown) {
      // Two concurrent requests raced past the findFirst check above and both
      // reached create. The unique index on (listingId, buyerId) kicks one
      // out with P2002 — surface it as an idempotent "already purchased"
      // instead of bubbling up a 500.
      if (
        err &&
        typeof err === 'object' &&
        'code' in err &&
        (err as { code: string }).code === 'P2002'
      ) {
        const existing = await this.prisma.marketPurchase.findFirst({
          where: { listingId, buyerId },
        });
        if (existing) return { success: true, alreadyPurchased: true, purchase: existing };
      }
      throw err;
    }

    // Auto-create welcome message in order chat
    try {
      const escrowNote = useEscrow
        ? ' Funds are held in escrow and will be released when you confirm delivery.'
        : '';
      await this.prisma.orderMessage.create({
        data: {
          orderId: purchase.id,
          senderId: listing.sellerId,
          content: `Order created! Payment confirmed on-chain.${escrowNote} I'm ready to fulfill your order for "${listing.title}". Feel free to message me here with any questions.`,
        },
      });
    } catch (err) {
      this.logger.error('Failed to create order welcome message', err);
    }

    try {
      await this.notifications.create({
        userId: listing.sellerId,
        type: 'MARKET_NEW_SALE',
        title: `New sale: "${listing.title}"`,
        body: `Your listing just sold. ${useEscrow ? 'Funds are in escrow — mark the order as delivered to release them.' : 'The order is ready to be fulfilled.'}`,
        url: `/orders/${purchase.id}`,
        meta: { listingId, orderId: purchase.id, buyerId },
      });
    } catch (err) {
      this.logger.warn(
        `Failed to emit sale notification: ${err instanceof Error ? err.message : err}`,
      );
    }

    // Broadcast to live market feed (fire-and-forget, public data only)
    try {
      const [buyerUser, sellerUser] = await Promise.all([
        this.prisma.user.findUnique({
          where: { id: buyerId },
          select: { id: true, username: true, avatarUrl: true },
        }),
        this.prisma.user.findUnique({
          where: { id: listing.sellerId },
          select: { id: true, username: true },
        }),
      ]);
      const eth = verifiedAmountWei ? Number(verifiedAmountWei) / 1e18 : null;
      this.gateway.emitSale({
        listingId: listing.id,
        listingTitle: listing.title,
        listingType: listing.type,
        amountWei: verifiedAmountWei ?? '0',
        priceEth: eth !== null && Number.isFinite(eth) ? Number(eth.toFixed(6)) : null,
        currency: listing.currency,
        buyer: buyerUser ?? { id: buyerId, username: null, avatarUrl: null },
        seller: sellerUser ?? { id: listing.sellerId, username: null },
        createdAt: purchase.createdAt.toISOString(),
      });
    } catch (err) {
      this.logger.warn(
        `Failed to broadcast sale event: ${err instanceof Error ? err.message : err}`,
      );
    }

    // Reputation: award BOTH seller and buyer for a confirmed sale.
    // Sellers get LISTING_SOLD / FIRST_SALE; buyers get LISTING_PURCHASED /
    // FIRST_PURCHASE. First-* bonuses fire once across listings + repos.
    try {
      const [priorSales, priorMarketBuys, priorRepoBuys] = await Promise.all([
        this.prisma.marketPurchase.count({
          where: { sellerId: listing.sellerId, verified: true, id: { not: purchase.id } },
        }),
        this.prisma.marketPurchase.count({
          where: { buyerId, verified: true, id: { not: purchase.id } },
        }),
        this.prisma.repoPurchase.count({ where: { buyerId, verified: true } }),
      ]);

      const sellerReason = priorSales === 0 ? 'FIRST_SALE' : 'LISTING_SOLD';
      this.reputation
        .awardPoints(listing.sellerId, sellerReason, purchase.id, listing.title)
        .catch((err) =>
          this.logger.warn(
            `Seller rays award failed for sale ${purchase.id}: ${err instanceof Error ? err.message : err}`,
          ),
        );

      const buyerReason =
        priorMarketBuys + priorRepoBuys === 0 ? 'FIRST_PURCHASE' : 'LISTING_PURCHASED';
      this.reputation
        .awardPoints(buyerId, buyerReason, purchase.id, listing.title)
        .catch((err) =>
          this.logger.warn(
            `Buyer rays award failed for purchase ${purchase.id}: ${err instanceof Error ? err.message : err}`,
          ),
        );
    } catch (err) {
      this.logger.warn(
        `Reputation award skipped for sale ${purchase.id}: ${err instanceof Error ? err.message : err}`,
      );
    }

    // Purchase confirmation emails to both parties (fire-and-forget)
    (async () => {
      try {
        const parties = await this.prisma.user.findMany({
          where: { id: { in: [buyerId, listing.sellerId] } },
          select: {
            id: true,
            email: true,
            username: true,
            notificationPreference: { select: { emailOrderUpdates: true } },
          },
        });
        const buyerRec = parties.find((p) => p.id === buyerId);
        const sellerRec = parties.find((p) => p.id === listing.sellerId);
        const eth = verifiedAmountWei ? Number(verifiedAmountWei) / 1e18 : 0;
        const amountLabel =
          Number.isFinite(eth) && eth > 0
            ? `${eth.toFixed(6).replace(/0+$/, '').replace(/\.$/, '')} ${listing.currency || 'ETH'}`
            : `${listing.price} ${listing.currency || 'ETH'}`;
        const payload = {
          buyerUsername: buyerRec?.username || 'buyer',
          sellerUsername: sellerRec?.username || 'seller',
          listingTitle: listing.title,
          orderId: purchase.id,
          amountLabel,
          txHash: purchase.txHash,
          purchaseKind: 'listing' as const,
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
          `Purchase email failed for sale ${purchase.id}: ${err instanceof Error ? err.message : err}`,
        );
      }
    })();

    return { success: true, purchase, orderId: purchase.id, escrow: useEscrow };
  }

  async deleteListing(id: string, userId: string) {
    const listing = await this.prisma.marketListing.findUnique({ where: { id } });
    if (!listing) throw new NotFoundException('Listing not found');

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { role: true },
    });
    if (listing.sellerId !== userId && !['ADMIN', 'MODERATOR'].includes(user?.role || '')) {
      throw new ForbiddenException('Insufficient permissions');
    }

    await this.prisma.marketListing.update({ where: { id }, data: { status: 'REMOVED' } });
  }

  // ── Ticker / Leaderboard ───────────────────────────────────────────────────
  // Cheap aggregate used by the global header marquee + leaderboard page.
  // Cached in-process for 90s — the queries are ~5x groupBy / findMany each
  // so a bursty homepage shouldn't hammer Postgres on every load. The
  // leaderboard is also cached separately (slightly longer payload, same TTL)
  // so /leaderboard doesn't recompute on every navigation.
  private tickerCache: { at: number; data: { topAgents: unknown[]; topDevs: unknown[] } } | null =
    null;
  // Leaderboard cache moved to Redis (key `market:leaderboard:v1`) so it
  // survives single-instance Render restarts; the in-process Map version
  // dropped on every redeploy and made every fresh boot the slowest hit
  // on the platform.

  async getTickerSnapshot() {
    const now = Date.now();
    if (this.tickerCache && now - this.tickerCache.at < 90_000) {
      return this.tickerCache.data;
    }

    const [topAgents, topDevs] = await Promise.all([
      this.getTopAgents(10),
      this.getTopDevelopers(10),
    ]);
    const data = { topAgents, topDevs };
    this.tickerCache = { at: now, data };
    return data;
  }

  async getTopAgents(limit = 10) {
    const sales = await this.prisma.marketPurchase.groupBy({
      by: ['listingId'],
      _count: { _all: true },
      orderBy: { _count: { listingId: 'desc' } },
      take: limit,
    });

    const listingSelect = {
      id: true,
      title: true,
      price: true,
      currency: true,
      type: true,
      tags: true,
      boostedUntil: true,
      createdAt: true,
      seller: {
        select: { id: true, username: true, avatarUrl: true, reputationPoints: true },
      },
    } as const;

    // 1) Listings with purchases — ranked by sales count.
    const salesByListing = new Map(sales.map((s) => [s.listingId, s._count._all]));
    const soldListings =
      sales.length === 0
        ? []
        : await this.prisma.marketListing.findMany({
            where: { id: { in: sales.map((s) => s.listingId) }, status: 'ACTIVE' },
            select: listingSelect,
          });
    const soldById = new Map(soldListings.map((l) => [l.id, l]));

    const resultsWithSales = sales
      .map((s) => soldById.get(s.listingId))
      .filter((l): l is NonNullable<typeof l> => !!l)
      .map((l) => {
        const salesCount = salesByListing.get(l.id) || 0;
        return {
          id: l.id,
          title: l.title,
          price: l.price,
          currency: l.currency,
          type: l.type,
          tags: l.tags,
          sales: salesCount,
          earnings: Number((l.price * salesCount).toFixed(4)),
          boosted: l.boostedUntil ? l.boostedUntil.getTime() > Date.now() : false,
          sellerId: l.seller.id,
          sellerUsername: l.seller.username,
          sellerAvatar: l.seller.avatarUrl,
          sellerReputation: l.seller.reputationPoints,
        };
      });

    // 2) If we don't have `limit` yet, backfill with top active listings
    //    ordered by boost (active first), then recency. This keeps the
    //    ticker populated even before the marketplace has sales history.
    const deficit = limit - resultsWithSales.length;
    if (deficit > 0) {
      const filler = await this.prisma.marketListing.findMany({
        where: {
          status: 'ACTIVE',
          id: { notIn: resultsWithSales.map((r) => r.id) },
        },
        orderBy: [{ boostedUntil: 'desc' }, { createdAt: 'desc' }],
        take: deficit,
        select: listingSelect,
      });
      for (const l of filler) {
        resultsWithSales.push({
          id: l.id,
          title: l.title,
          price: l.price,
          currency: l.currency,
          type: l.type,
          tags: l.tags,
          sales: 0,
          earnings: 0,
          boosted: l.boostedUntil ? l.boostedUntil.getTime() > Date.now() : false,
          sellerId: l.seller.id,
          sellerUsername: l.seller.username,
          sellerAvatar: l.seller.avatarUrl,
          sellerReputation: l.seller.reputationPoints,
        });
      }
    }

    return resultsWithSales;
  }

  async getTopDevelopers(limit = 10) {
    const devs = await this.prisma.user.findMany({
      where: { isBanned: false, isBot: false },
      orderBy: [{ reputationPoints: 'desc' }, { createdAt: 'asc' }],
      take: limit,
      select: {
        id: true,
        username: true,
        displayName: true,
        avatarUrl: true,
        reputationPoints: true,
        bio: true,
      },
    });
    if (devs.length === 0) return [];

    // Pull sale records with their listing price so we can both count sales
    // and sum earnings per seller in one round trip.
    const purchases = await this.prisma.marketPurchase.findMany({
      where: { sellerId: { in: devs.map((d) => d.id) } },
      select: { sellerId: true, listing: { select: { price: true } } },
    });
    const salesById = new Map<string, number>();
    const earningsById = new Map<string, number>();
    for (const p of purchases) {
      salesById.set(p.sellerId, (salesById.get(p.sellerId) || 0) + 1);
      earningsById.set(p.sellerId, (earningsById.get(p.sellerId) || 0) + (p.listing?.price ?? 0));
    }

    return devs.map((d) => ({
      id: d.id,
      username: d.username,
      displayName: d.displayName,
      avatarUrl: d.avatarUrl,
      reputationPoints: d.reputationPoints,
      bio: d.bio,
      totalSales: salesById.get(d.id) || 0,
      totalEarnings: Number((earningsById.get(d.id) || 0).toFixed(4)),
    }));
  }

  async getLeaderboard() {
    // Two-tab leaderboard payload — top agents (by sales) + top devs (by rep).
    // Cached 90s in Redis (was: in-process Map). Each tab runs ~5 aggregate
    // queries, so this used to be the single slowest endpoint on cold
    // navigation — the in-process cache only survived for one Node instance,
    // so a Render redeploy / cold instance always re-ran the full
    // aggregation. Redis means the cache actually persists across deploys
    // and cron warm-ups, so users effectively always hit a warm cache.
    const cacheKey = 'market:leaderboard:v1';
    const cached = await this.redis.get(cacheKey).catch(() => null);
    if (cached) {
      try {
        return JSON.parse(cached);
      } catch {
        /* corrupt entry — fall through to recompute */
      }
    }
    const [topAgents, topDevs] = await Promise.all([
      this.getTopAgents(25),
      this.getTopDevelopers(25),
    ]);
    const data = { topAgents, topDevs };
    await this.redis.set(cacheKey, JSON.stringify(data), 90).catch(() => null);
    return data;
  }

  // ── Listing boosts ─────────────────────────────────────────────────────────
  async boostListing(
    listingId: string,
    userId: string,
    input: { durationDays?: number; amountTokens?: number; txHash?: string },
  ) {
    const days = Math.min(30, Math.max(1, Math.floor(input.durationDays ?? 7)));
    // Fixed pricing tiers (in HAGGL tokens) — keep simple/predictable for now.
    const priceByDays: Record<number, number> = { 1: 5, 3: 12, 7: 25, 14: 45, 30: 80 };
    const price = priceByDays[days] ?? Math.ceil(days * 4);

    const listing = await this.prisma.marketListing.findUnique({
      where: { id: listingId },
      select: { id: true, sellerId: true, status: true, title: true, boostedUntil: true },
    });
    if (!listing) throw new NotFoundException('Listing not found');
    if (listing.status !== 'ACTIVE') {
      throw new BadRequestException('Only active listings can be boosted');
    }
    if (listing.sellerId !== userId) {
      throw new ForbiddenException('Only the seller can boost this listing');
    }

    // ── On-chain payment verification ─────────────────────────────────────
    // Previously boosts were free: whoever called this endpoint just got a
    // boost. Require a txHash and verify the token/ETH transfer to the
    // platform wallet before crediting.
    const txHash = (input.txHash || '').trim();
    if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
      throw new BadRequestException('A valid payment txHash is required to boost');
    }
    const dupBoost = await this.prisma.listingBoost.findUnique({ where: { txHash } });
    if (dupBoost) throw new ForbiddenException('Transaction already used for a boost');

    const platformWallet = this.config.get<string>('PLATFORM_WALLET', '');
    if (!platformWallet) {
      throw new BadRequestException('Platform wallet not configured — boosts disabled');
    }
    const rpcUrl = this.config.get<string>('ETH_RPC_URL', 'https://mainnet.base.org');
    const tokenContract = this.config.get<string>('HAGGL_TOKEN_CONTRACT', '');
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const receipt = await provider.getTransactionReceipt(txHash);
    if (!receipt || receipt.status !== 1) {
      throw new BadRequestException('Payment transaction failed or not found');
    }
    // Boosts are priced in HAGGL tokens (18 decimals); the same scale
    // applies whether we accept the token or raw ETH as a fallback.
    const expectedWei = ethers.parseEther(price.toString());
    if (tokenContract) {
      const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
      const transferLog = receipt.logs.find(
        (log) =>
          log.address.toLowerCase() === tokenContract.toLowerCase() &&
          log.topics[0] === TRANSFER_TOPIC &&
          log.topics[2] &&
          '0x' + log.topics[2].slice(26).toLowerCase() === platformWallet.toLowerCase(),
      );
      if (!transferLog) {
        throw new BadRequestException('No valid HAGGL transfer to platform wallet found');
      }
      if (BigInt(transferLog.data) < expectedWei) {
        throw new BadRequestException('Payment is below the required boost amount');
      }
    } else {
      const tx = await provider.getTransaction(txHash);
      if (!tx) throw new BadRequestException('Payment transaction not found');
      if (tx.to?.toLowerCase() !== platformWallet.toLowerCase()) {
        throw new BadRequestException('Payment recipient does not match platform wallet');
      }
      if (BigInt(tx.value) < expectedWei) {
        throw new BadRequestException('Payment is below the required boost amount');
      }
    }

    // Extend any in-flight boost rather than overwrite — buyers stack durations.
    const baseFrom =
      listing.boostedUntil && listing.boostedUntil.getTime() > Date.now()
        ? listing.boostedUntil
        : new Date();
    const expiresAt = new Date(baseFrom.getTime() + days * 24 * 60 * 60 * 1000);

    const [updated] = await this.prisma.$transaction([
      this.prisma.marketListing.update({
        where: { id: listingId },
        data: { boostedUntil: expiresAt },
      }),
      this.prisma.listingBoost.create({
        data: {
          listingId,
          buyerId: userId,
          amountTokens: price,
          durationDays: days,
          expiresAt,
          txHash,
        },
      }),
    ]);
    // Drop the ticker + leaderboard caches so the boost shows up immediately.
    this.tickerCache = null;
    await this.redis.del('market:leaderboard:v1').catch(() => null);
    return {
      ok: true,
      boostedUntil: updated.boostedUntil,
      durationDays: days,
      amountTokens: price,
    };
  }

  getBoostPricing() {
    return {
      currency: 'HAGGL',
      platformWallet: this.config.get<string>('PLATFORM_WALLET', '') || null,
      tokenContract: this.config.get<string>('HAGGL_TOKEN_CONTRACT', '') || null,
      tiers: [
        { days: 1, price: 5 },
        { days: 3, price: 12 },
        { days: 7, price: 25 },
        { days: 14, price: 45 },
        { days: 30, price: 80 },
      ],
    };
  }
}
