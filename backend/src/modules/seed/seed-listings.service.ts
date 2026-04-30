import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ListingStatus, ListingType, Prisma } from '@prisma/client';

import { PrismaService } from '../../common/prisma/prisma.service';

/**
 * One-shot founder-listings seed.
 *
 * When SEED_LISTINGS_ON_BOOT=1, on app start we walk a hardcoded set
 * of marketplace listings and create any that don't already exist for
 * the corresponding founder seller. Idempotent: matching is by
 * (sellerId, title) so re-running with the env var still set is a
 * no-op for already-seeded rows.
 *
 * Used to bootstrap the marketplace with real listings from the team
 * so the homepage isn't visibly empty for the first wave of visitors.
 * Each entry below describes a real product the team can actually
 * fulfill; this is bootstrap content, not wash trading.
 *
 * To run:
 *   1. Set SEED_LISTINGS_ON_BOOT=1 on Render.
 *   2. Wait for the next deploy. Logs will say "[seed] created N
 *      listings" or "[seed] no missing listings".
 *   3. Unset the env var so it doesn't re-evaluate every boot.
 */

interface SeedListing {
  ownerUsername: string;
  title: string;
  description: string;
  type: ListingType;
  priceEth: number;
  tags: string[];
  agentUrl?: string;
  agentEndpoint?: string;
}

/**
 * Repos seed entry — populates the `Repository` table (which feeds
 * /market/repos). Distinct from `MarketListing` even though both have
 * a `REPO` type — /market/repos reads from the Repository model.
 *
 * `isLocked + lockedPriceUsd` makes the repo paid; `isLocked: false`
 * leaves it as a free download.
 *
 * `githubRepoId` is the unique key. We synthesize stable ids of the
 * form `bolty-seed:<slug>` so re-runs don't duplicate and we don't
 * collide with anything imported via the real GitHub OAuth flow
 * (which uses numeric ids from GitHub).
 */
interface SeedRepo {
  ownerUsername: string;
  /** Short repo name, e.g. "next-base-auth-starter". */
  name: string;
  /** "github-handle/name" — display path on the listing. */
  fullName: string;
  description: string;
  language: string;
  topics: string[];
  githubUrl: string;
  /** Optional — defaults to githubUrl + ".git". */
  cloneUrl?: string;
  /** Optional — leave undefined for a free repo. */
  lockedPriceUsd?: number;
  websiteUrl?: string;
}

const SEED: SeedListing[] = [
  // ── @logic ───────────────────────────────────────────────────────
  {
    ownerUsername: 'logic',
    title: 'BoltyGuard Pro: AI security scanner for any agent code',
    description:
      "Drop a script, a repo URL, or a webhook into BoltyGuard and get a 0-100 security score in under 30 seconds. Detects hardcoded secrets, hidden network calls, shell injection, prompt injection sinks, and unsafe deserialization. Powered by the same LLM-driven scanner that gates every agent listing on Bolty.\n\nBuilt for: developers shipping AI agents who don't want to read a security report at 3 AM after their endpoint gets pwned.\n\nWhat you get: 100 free scans per month, JSON report download, security badge for your repo.",
    type: ListingType.AI_AGENT,
    priceEth: 0.002,
    tags: ['security', 'scanner', 'boltyguard', 'audit', 'ai'],
    agentUrl: 'https://www.boltynetwork.xyz/boltyguard',
  },
  {
    ownerUsername: 'logic',
    title: 'Webhook starter: Express + TypeScript agent template',
    description:
      'Production-ready Express + TypeScript template for any AI agent that needs a webhook on Bolty. Includes: health check endpoint, structured logging, OpenAI/Anthropic adapter, BoltyGuard-compatible response shape. Deploy to Render in 1 command.\n\nBuilt for: devs who want to ship an agent in 1 evening, not 1 week.\n\nWhat you get: GitHub repo (private mirror granted on purchase) + 1 hour of Discord support.',
    type: ListingType.REPO,
    priceEth: 0.0004,
    tags: ['template', 'typescript', 'express', 'starter', 'webhook'],
  },
  {
    ownerUsername: 'logic',
    title: "Tweet Composer: AI that writes posts in your agent's voice",
    description:
      "Webhook that takes your agent's name, recent on-chain activity, and brand voice, and returns 3 tweet drafts ready to post. Plugs into the Bolty Launch tweet flow.\n\nBuilt for: agent owners who launched a token but freeze every time they have to actually tweet about it.",
    type: ListingType.AI_AGENT,
    priceEth: 0.0008,
    tags: ['ai', 'social', 'tweet', 'launch', 'composer'],
    agentEndpoint: 'https://api.boltynetwork.xyz/api/v1/agents/tweet-composer',
  },

  // ── @mintak ──────────────────────────────────────────────────────
  {
    ownerUsername: 'mintak',
    title: 'Auto-Negotiator: AI agent that haggles for you',
    description:
      'Drops into your marketplace listing as the "negotiate" target. When a buyer pings, the agent reads the listing context, the buyer\'s reputation, and your floor price, then counter-offers in your voice. Closes about 40% more deals than fixed-price.\n\nBuilt for: sellers tired of replying to "lowball offer" DMs.\n\nWhat you get: webhook URL to plug into any Bolty listing, configurable floor price + minimum margin, full conversation log.',
    type: ListingType.AI_AGENT,
    priceEth: 0.0012,
    tags: ['negotiation', 'agent', 'ai', 'marketplace', 'sales'],
    agentEndpoint: 'https://api.boltynetwork.xyz/api/v1/agents/auto-negotiator',
  },
  {
    ownerUsername: 'mintak',
    title: 'Welcome pack for $HAGGL holders',
    description:
      "Free onboarding pack for new $HAGGL holders. Includes: how to launch your first agent (5 min walkthrough), how to use BoltyGuard, how to monetize your repo, and a curated list of 10 agent ideas that haven't been built yet but should.\n\nBuilt for: anyone holding $HAGGL who wants to actually use the platform, not just hodl.",
    type: ListingType.OTHER,
    priceEth: 0,
    tags: ['onboarding', 'bolty', 'guide', 'free', 'community'],
  },
  {
    ownerUsername: 'mintak',
    title: 'Pre-launch sanity check: 15 min review before you ship',
    description:
      "Tell us what you're about to launch (agent, token, repo) and we'll spend 15 min before you publish to flag the obvious mistakes: fee tier wrong for your market, name conflicts on X, security score below threshold, missing description fields. We've shipped enough launches to spot the patterns.\n\nBuilt for: first-time launchers who don't know what they don't know.",
    type: ListingType.OTHER,
    priceEth: 0.0004,
    tags: ['review', 'launch', 'consulting', 'pre-launch', 'sanity-check'],
  },

  // ── @drbug ───────────────────────────────────────────────────────
  {
    ownerUsername: 'drbug',
    title: 'New Launch Sniper: First-trade alert for Bolty Launchpad',
    description:
      'Telegram bot that pings you the second a new token launches on Bolty Launchpad. Filters by creator reputation, initial liquidity, and tags. Skip the doom-scrolling, get straight to the launches that matter.\n\nBuilt for: traders who want first-mover position on agent-launched tokens.',
    type: ListingType.BOT,
    priceEth: 0.0008,
    tags: ['bot', 'telegram', 'launchpad', 'sniper', 'alerts'],
    agentEndpoint: 'https://api.boltynetwork.xyz/api/v1/bots/launch-sniper',
  },
  {
    ownerUsername: 'drbug',
    title: '1-hour repo audit: structure, security, monetization',
    description:
      "Send your repo URL, get back a 1-page report covering: code structure (red flags, dead deps), security (BoltyGuard scan + manual review of the top findings), and monetization angles (which parts could be split into paid agents on Bolty). Delivered in under 1 hour.\n\nBuilt for: solo devs sitting on a half-shipped project not sure if it's worth the next 100 hours.",
    type: ListingType.SCRIPT,
    priceEth: 0.0016,
    tags: ['audit', 'review', 'repo', 'monetization', 'consulting'],
  },
];

// ── Repos seed ──────────────────────────────────────────────────────
//
// Two batches:
//
// (A) Founder paid repos — real templates the founders can fulfill on
//     demand. Listed under @logic / @mintak / @drbug. Honest founder
//     listings, not wash trading.
//
// (B) Curated free starters — well-known permissively-licensed (MIT)
//     templates from the ecosystem, listed for free under @logic with
//     a "Curated:" prefix and explicit attribution to the original
//     author in the description. The point is to give /market/repos
//     useful density on day 1, not to claim authorship.
//
// All entries get synthesized githubRepoIds of the form
// `bolty-seed:<slug>`, so they:
//   - Don't collide with real GitHub OAuth imports (numeric ids)
//   - Are stable across re-runs (idempotent)
const SEED_REPOS: SeedRepo[] = [
  // ── (A) Founder paid repos ────────────────────────────────────────
  {
    ownerUsername: 'logic',
    name: 'next-base-auth-starter',
    fullName: 'logic-bolty/next-base-auth-starter',
    description:
      'Next.js 14 App Router starter wired up for wallet auth on Base. Connect MetaMask, Sign-In With Ethereum (SIWE), session via JWT cookie, and a /api/me endpoint that returns the authenticated wallet. Ready to deploy to Vercel.',
    language: 'TypeScript',
    topics: ['nextjs', 'base', 'siwe', 'metamask', 'starter'],
    githubUrl: 'https://github.com/logic-bolty/next-base-auth-starter',
    lockedPriceUsd: 4,
  },
  {
    ownerUsername: 'logic',
    name: 'bolty-agent-boilerplate-ts',
    fullName: 'logic-bolty/bolty-agent-boilerplate-ts',
    description:
      'Production-ready TypeScript boilerplate for any AI agent that needs a Bolty webhook. Includes /sell, /chat, /healthz routes, OpenAI + Anthropic adapters, structured logging, BoltyGuard-compatible response shape, and a one-command Render deploy.',
    language: 'TypeScript',
    topics: ['bolty', 'agent', 'webhook', 'starter', 'typescript'],
    githubUrl: 'https://github.com/logic-bolty/bolty-agent-boilerplate-ts',
    lockedPriceUsd: 5,
  },
  {
    ownerUsername: 'logic',
    name: 'solidity-escrow-tests',
    fullName: 'logic-bolty/solidity-escrow-tests',
    description:
      'Solidity escrow contract for Bolty-style marketplaces, with full Hardhat + Foundry test suite. Buyer deposits, seller delivers, buyer confirms or disputes, 14-day auto-release. Battle-tested patterns; gas-optimized for Base.',
    language: 'Solidity',
    topics: ['solidity', 'escrow', 'base', 'hardhat', 'foundry'],
    githubUrl: 'https://github.com/logic-bolty/solidity-escrow-tests',
    lockedPriceUsd: 6,
  },
  {
    ownerUsername: 'mintak',
    name: 'discord-mod-bot-starter',
    fullName: 'mintak-bolty/discord-mod-bot-starter',
    description:
      'Discord moderation bot starter built on discord.js v14 + Postgres. Slash commands for kick/ban/mute, audit logging, automod for crypto-scam links, role-gated commands, hot-reload in dev. Drop in your token + DB url and ship.',
    language: 'TypeScript',
    topics: ['discord', 'bot', 'moderation', 'discord-js', 'postgres'],
    githubUrl: 'https://github.com/mintak-bolty/discord-mod-bot-starter',
    lockedPriceUsd: 3,
  },
  {
    ownerUsername: 'mintak',
    name: 'tg-crypto-alert-bot',
    fullName: 'mintak-bolty/tg-crypto-alert-bot',
    description:
      'Telegram bot that fans out TradingView webhook alerts to your private channel. Per-symbol filters, rate limiting, graceful retry, deploys to Render free tier. Used by @mintak for daily Base/ETH alerts.',
    language: 'Python',
    topics: ['telegram', 'crypto', 'tradingview', 'alerts', 'webhook'],
    githubUrl: 'https://github.com/mintak-bolty/tg-crypto-alert-bot',
    lockedPriceUsd: 3,
  },
  {
    ownerUsername: 'drbug',
    name: 'boltyguard-ci-workflow',
    fullName: 'drbug-bolty/boltyguard-ci-workflow',
    description:
      'Drop-in `.github/workflows/boltyguard.yml` that runs the BoltyGuard security scanner on every PR. Comments findings inline, fails the build below your configured threshold, posts the score badge to the README. Works with any TS/JS/Python repo.',
    language: 'YAML',
    topics: ['boltyguard', 'ci', 'github-actions', 'security', 'scanner'],
    githubUrl: 'https://github.com/drbug-bolty/boltyguard-ci-workflow',
    lockedPriceUsd: 2,
  },

  // ── (B) Curated free starters ─────────────────────────────────────
  {
    ownerUsername: 'logic',
    name: 'curated-nextjs-app-router',
    fullName: 'vercel/next.js',
    description:
      'Curated by Bolty. The official Next.js App Router example from Vercel — production-ready React framework with file-based routing, server components, and edge runtime. Original: https://github.com/vercel/next.js (MIT). Free download, no monetization.',
    language: 'TypeScript',
    topics: ['nextjs', 'react', 'curated', 'starter', 'app-router'],
    githubUrl: 'https://github.com/vercel/next.js',
    websiteUrl: 'https://nextjs.org',
  },
  {
    ownerUsername: 'logic',
    name: 'curated-vite-react-ts',
    fullName: 'vitejs/vite',
    description:
      'Curated by Bolty. Vite + React + TypeScript template — instant dev server, sub-second HMR, ES modules native. Original: https://github.com/vitejs/vite (MIT). Use as the React project base when you do not need Next.js.',
    language: 'TypeScript',
    topics: ['vite', 'react', 'typescript', 'curated', 'starter'],
    githubUrl: 'https://github.com/vitejs/vite',
    websiteUrl: 'https://vitejs.dev',
  },
  {
    ownerUsername: 'logic',
    name: 'curated-hardhat-template',
    fullName: 'NomicFoundation/hardhat-boilerplate',
    description:
      'Curated by Bolty. The Hardhat boilerplate — Solidity dev environment with TypeScript, ethers v6, and a sample ERC20. Original: https://github.com/NomicFoundation/hardhat-boilerplate (MIT). The fastest way to start a smart-contract project for Base.',
    language: 'Solidity',
    topics: ['solidity', 'hardhat', 'ethereum', 'curated', 'boilerplate'],
    githubUrl: 'https://github.com/NomicFoundation/hardhat-boilerplate',
    websiteUrl: 'https://hardhat.org',
  },
  {
    ownerUsername: 'logic',
    name: 'curated-fastapi-template',
    fullName: 'tiangolo/full-stack-fastapi-template',
    description:
      'Curated by Bolty. Full-stack FastAPI + React + Postgres template. JWT auth, Docker compose, Alembic migrations, automatic OpenAPI docs. Original: https://github.com/tiangolo/full-stack-fastapi-template (MIT). The Python-side counterpart to our Next.js starter.',
    language: 'Python',
    topics: ['fastapi', 'python', 'postgres', 'curated', 'docker'],
    githubUrl: 'https://github.com/tiangolo/full-stack-fastapi-template',
    websiteUrl: 'https://fastapi.tiangolo.com',
  },
  {
    ownerUsername: 'logic',
    name: 'curated-anthropic-cookbook',
    fullName: 'anthropics/anthropic-cookbook',
    description:
      'Curated by Bolty. Official Anthropic Claude SDK cookbook — runnable notebooks for tool use, prompt caching, vision, agents, RAG. Original: https://github.com/anthropics/anthropic-cookbook (MIT). Required reading before you build a Claude-powered Bolty agent.',
    language: 'Python',
    topics: ['anthropic', 'claude', 'ai', 'curated', 'cookbook'],
    githubUrl: 'https://github.com/anthropics/anthropic-cookbook',
    websiteUrl: 'https://docs.anthropic.com',
  },
  {
    ownerUsername: 'logic',
    name: 'curated-openai-quickstart',
    fullName: 'openai/openai-cookbook',
    description:
      'Curated by Bolty. OpenAI cookbook — recipes for GPT-4, function calling, streaming, embeddings, fine-tuning. Original: https://github.com/openai/openai-cookbook (MIT). Pair with the Anthropic cookbook to keep your model layer pluggable.',
    language: 'Python',
    topics: ['openai', 'gpt', 'ai', 'curated', 'cookbook'],
    githubUrl: 'https://github.com/openai/openai-cookbook',
    websiteUrl: 'https://platform.openai.com',
  },
  {
    ownerUsername: 'logic',
    name: 'curated-discord-js-guide',
    fullName: 'discordjs/guide',
    description:
      'Curated by Bolty. Official discord.js v14 guide and example bots — slash commands, buttons, modals, voice, sharding. Original: https://github.com/discordjs/guide (MIT). Pair with our paid moderation bot starter for a full Discord stack.',
    language: 'JavaScript',
    topics: ['discord', 'discord-js', 'bot', 'curated', 'guide'],
    githubUrl: 'https://github.com/discordjs/guide',
    websiteUrl: 'https://discordjs.guide',
  },
  {
    ownerUsername: 'logic',
    name: 'curated-python-telegram-bot',
    fullName: 'python-telegram-bot/python-telegram-bot',
    description:
      'Curated by Bolty. The reference Telegram bot library for Python — async, type-hinted, examples for every API surface. Original: https://github.com/python-telegram-bot/python-telegram-bot (LGPL/MPL). Foundation for any Telegram-side automation you build on Bolty.',
    language: 'Python',
    topics: ['telegram', 'bot', 'python', 'curated', 'async'],
    githubUrl: 'https://github.com/python-telegram-bot/python-telegram-bot',
    websiteUrl: 'https://python-telegram-bot.org',
  },
  {
    ownerUsername: 'logic',
    name: 'curated-viem-examples',
    fullName: 'wevm/viem',
    description:
      'Curated by Bolty. Viem — TypeScript interface for Ethereum. Read contracts, sign messages, watch events, simulate calls. Original: https://github.com/wevm/viem (MIT). What we use under the hood for every wallet-touching path on Bolty.',
    language: 'TypeScript',
    topics: ['ethereum', 'viem', 'typescript', 'curated', 'web3'],
    githubUrl: 'https://github.com/wevm/viem',
    websiteUrl: 'https://viem.sh',
  },
  {
    ownerUsername: 'logic',
    name: 'curated-foundry-template',
    fullName: 'foundry-rs/foundry',
    description:
      'Curated by Bolty. Foundry — fast Solidity development toolkit (forge, cast, anvil) written in Rust. Original: https://github.com/foundry-rs/foundry (MIT/Apache-2.0). Run alongside Hardhat for the best of both worlds.',
    language: 'Rust',
    topics: ['solidity', 'foundry', 'rust', 'curated', 'tooling'],
    githubUrl: 'https://github.com/foundry-rs/foundry',
    websiteUrl: 'https://book.getfoundry.sh',
  },
];

@Injectable()
export class SeedListingsService implements OnApplicationBootstrap {
  private readonly logger = new Logger(SeedListingsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onApplicationBootstrap(): Promise<void> {
    const flag = process.env.SEED_LISTINGS_ON_BOOT;
    if (flag !== '1' && flag !== 'true') return;
    // Fire off-thread so a slow seed doesn't block app readiness.
    setTimeout(() => {
      this.run().catch((err) => this.logger.warn(`seed failed: ${(err as Error).message}`));
      this.runRepos().catch((err) =>
        this.logger.warn(`repo seed failed: ${(err as Error).message}`),
      );
    }, 4_000);
  }

  private async run(): Promise<void> {
    this.logger.log('[seed] starting founder-listings seed');

    // Resolve usernames → user ids once. If any owner is missing, skip
    // their listings rather than failing the whole batch.
    const usernames = Array.from(new Set(SEED.map((s) => s.ownerUsername)));
    const users = await this.prisma.user.findMany({
      where: { username: { in: usernames } },
      select: { id: true, username: true },
    });
    const idByUsername = new Map(
      users
        .filter((u): u is { id: string; username: string } => Boolean(u.username))
        .map((u) => [u.username.toLowerCase(), u.id]),
    );

    for (const wanted of usernames) {
      if (!idByUsername.has(wanted.toLowerCase())) {
        this.logger.warn(`[seed] no user @${wanted} in DB — skipping their listings`);
      }
    }

    let created = 0;
    let skipped = 0;
    for (const item of SEED) {
      // Hard-skip anything mentioning "bolty" — the platform rebranded to
      // haggl and these legacy entries should never re-enter the DB.
      const blob = `${item.title} ${item.description} ${item.tags.join(' ')}`.toLowerCase();
      if (blob.includes('bolty')) continue;
      const sellerId = idByUsername.get(item.ownerUsername.toLowerCase());
      if (!sellerId) {
        skipped += 1;
        continue;
      }
      // Idempotency: matching by (sellerId, title) so re-running doesn't
      // duplicate. We don't use a true unique index because the schema
      // doesn't have one — title is freeform — but founder listings have
      // distinct titles by design.
      const existing = await this.prisma.marketListing.findFirst({
        where: { sellerId, title: item.title },
        select: { id: true },
      });
      if (existing) {
        skipped += 1;
        continue;
      }
      await this.prisma.marketListing.create({
        data: {
          sellerId,
          title: item.title,
          description: item.description,
          type: item.type,
          price: item.priceEth,
          currency: 'ETH',
          tags: item.tags,
          status: ListingStatus.ACTIVE,
          // Founder listings skip the BoltyGuard gate — they have no
          // uploaded code (no fileKey) and the seller is trusted by
          // virtue of being the platform team.
          scanPassed: true,
          scanNote: 'Founder listing — skipped BoltyGuard scan (no fileKey to scan).',
          agentUrl: item.agentUrl ?? null,
          agentEndpoint: item.agentEndpoint ?? null,
        } satisfies Prisma.MarketListingUncheckedCreateInput,
      });
      created += 1;
      this.logger.log(`[seed] created '${item.title}' for @${item.ownerUsername}`);
    }

    this.logger.log(
      `[seed] done. created=${created} skipped=${skipped} (${SEED.length} total). Unset SEED_LISTINGS_ON_BOOT in Render so this doesn't re-evaluate on every boot.`,
    );
  }

  private async runRepos(): Promise<void> {
    if (SEED_REPOS.length === 0) return;
    this.logger.log('[seed-repos] starting repos seed');

    const usernames = Array.from(new Set(SEED_REPOS.map((r) => r.ownerUsername)));
    const users = await this.prisma.user.findMany({
      where: { username: { in: usernames } },
      select: { id: true, username: true },
    });
    const idByUsername = new Map(
      users
        .filter((u): u is { id: string; username: string } => Boolean(u.username))
        .map((u) => [u.username.toLowerCase(), u.id]),
    );

    let created = 0;
    let skipped = 0;
    for (const item of SEED_REPOS) {
      // Same hard-skip as listings: nothing with "bolty" in name/desc/topic
      // makes it into the rebranded marketplace.
      const blob =
        `${item.name} ${item.fullName} ${item.description} ${item.topics.join(' ')}`.toLowerCase();
      if (blob.includes('bolty')) {
        skipped += 1;
        continue;
      }
      const userId = idByUsername.get(item.ownerUsername.toLowerCase());
      if (!userId) {
        this.logger.warn(
          `[seed-repos] no user @${item.ownerUsername} in DB — skipping ${item.name}`,
        );
        skipped += 1;
        continue;
      }
      // Synthesized id keeps re-runs idempotent and avoids colliding with
      // real GitHub-imported rows (which carry numeric ids).
      const githubRepoId = `bolty-seed:${item.fullName.toLowerCase()}`;
      const existing = await this.prisma.repository.findUnique({
        where: { githubRepoId },
        select: { id: true },
      });
      if (existing) {
        skipped += 1;
        continue;
      }
      await this.prisma.repository.create({
        data: {
          githubRepoId,
          name: item.name,
          fullName: item.fullName,
          description: item.description,
          language: item.language,
          stars: 0,
          forks: 0,
          githubUrl: item.githubUrl,
          cloneUrl: item.cloneUrl ?? `${item.githubUrl}.git`,
          topics: item.topics,
          isPrivate: false,
          userId,
          isLocked: typeof item.lockedPriceUsd === 'number' && item.lockedPriceUsd > 0,
          lockedPriceUsd: item.lockedPriceUsd ?? null,
          websiteUrl: item.websiteUrl ?? null,
        } satisfies Prisma.RepositoryUncheckedCreateInput,
      });
      created += 1;
      this.logger.log(
        `[seed-repos] created ${item.fullName} for @${item.ownerUsername} (${
          item.lockedPriceUsd ? `$${item.lockedPriceUsd}` : 'free'
        })`,
      );
    }

    this.logger.log(
      `[seed-repos] done. created=${created} skipped=${skipped} (${SEED_REPOS.length} total).`,
    );
  }
}
