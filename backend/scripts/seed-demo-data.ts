/**
 * Demo data seeder. Populates the marketplace with believable fake
 * users, listings, purchases and reviews so a fresh deployment looks
 * lived-in. All inserted rows carry `isSeed = true` so they can be
 * cleanly removed later. Aggregates (totals, leaderboards, top
 * sellers) intentionally do NOT filter on `isSeed`, so once real
 * users sign up their numbers add on top of the seed.
 *
 * Usage (from backend/):
 *   DATABASE_URL=postgres://... npx ts-node scripts/seed-demo-data.ts
 *
 * Re-running is safe — the script first deletes every `isSeed = true`
 * row in cascade-safe order before re-creating from scratch.
 */

import { PrismaClient, ListingType, ListingStatus, OrderStatus, EscrowStatus, ReputationReason } from '@prisma/client';

const prisma = new PrismaClient();

// ── Tunables ────────────────────────────────────────────────────────────────

const N_USERS = 60;
const N_LISTINGS = 100;
const N_PURCHASES = 400;
const N_REVIEWS = 250;
const DAYS_BACK = 90;

// Distribution of listings by type (must sum to N_LISTINGS).
const TYPE_DISTRIBUTION: Array<[ListingType, number]> = [
  ['AI_AGENT', 40],
  ['REPO', 30],
  ['BOT', 15],
  ['SCRIPT', 10],
  ['OTHER', 5],
];

// ── Random helpers ──────────────────────────────────────────────────────────

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

function pickWeighted<T>(items: Array<[T, number]>): T {
  const total = items.reduce((s, [, w]) => s + w, 0);
  let r = Math.random() * total;
  for (const [v, w] of items) {
    r -= w;
    if (r <= 0) return v;
  }
  return items[items.length - 1]![0];
}

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randFloat(min: number, max: number, decimals = 4): number {
  const n = Math.random() * (max - min) + min;
  return Math.round(n * 10 ** decimals) / 10 ** decimals;
}

function randomDateWithinDays(days: number): Date {
  const ms = Date.now() - Math.random() * days * 24 * 60 * 60 * 1000;
  return new Date(ms);
}

function randomWalletHex(): string {
  let s = '0x';
  for (let i = 0; i < 40; i++) s += '0123456789abcdef'[Math.floor(Math.random() * 16)];
  return s;
}

function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

// ── Content pools ───────────────────────────────────────────────────────────

const USERNAME_ROOTS = [
  'vesper', 'k0y0t3', 'mantis', 'zenith', 'phantom', 'nova', 'apex', 'orbit',
  'cipher', 'glitch', 'redshift', 'helios', 'lumen', 'flux', 'volt', 'praxis',
  'kraken', 'mango', 'ember', 'frost', 'rune', 'syntax', 'echo', 'mira',
  'atlas', 'jett', 'sable', 'wraith', 'kestrel', 'quasar', 'nyx', 'rhea',
  'orion', 'corvid', 'sigma', 'delta', 'lyra', 'arc', 'tide', 'meridian',
  'oracle', 'gemma', 'forge', 'kelvin', 'pylon', 'binary', 'parity', 'lattice',
  'monad', 'ronin', 'zephyr', 'reaper', 'icarus', 'vesta', 'lumen', 'spire',
  'coda', 'vector', 'parallax', 'horizon', 'wisp', 'mirage', 'ophir', 'prism',
];

const USERNAME_SUFFIXES = ['', '.dev', '.eth', '.sol', '_xyz', '99', '_lab', '_io', '01', '_'];

const BIOS = [
  'shipping solana primitives at 4am.',
  'quant + onchain. trade rare bytes.',
  'mev hunter. sometimes the prey.',
  'building the rails so you don\'t have to.',
  'ex-sre, full-time degen.',
  'rust, anchor, and bad sleep schedules.',
  'idle code is the devil\'s playground.',
  'opinionated about gas, ambivalent about everything else.',
  'we are so back.',
  'making the chain hum.',
  'ten years of latency, zero years of regret.',
  'compiling thoughts into shipped product.',
  'agent harness. autonomous trader. occasional coffee.',
  'former ml. current onchain. always tired.',
  'i write the bots that write the bots.',
  'tooling for builders who still ship at 3am.',
  '',
];

const LISTING_TITLES: Record<ListingType, string[]> = {
  AI_AGENT: [
    'Solana Mempool Watcher',
    'Jupiter Route Optimizer',
    'GPT-4o Trading Copilot',
    'Liquidity Health Daemon',
    'On-chain Anomaly Detector',
    'New-Pool Liquidity Scanner',
    'Floor-Price Tracking Agent',
    'Pyth Oracle Deviation Watcher',
    'Drift Funding Rate Reporter',
    'Compressed-NFT Mint Watcher',
    'Backtest Replay Engine — Anchor',
    'Birdeye Volume Spike Alerter',
    'Helius Webhook Relay Service',
    'On-chain News Synthesizer',
    'Whale Wallet Activity Bot',
    'Marginfi Liquidation Watcher',
    'Validator Uptime Pinger',
    'NFT Cohort Performance Tracker',
    'Pyth + Switchboard Aggregator',
    'Rust Audit Co-Pilot',
    'CLI Wallet Manager Pro',
    'TX Decoder & Anomaly Scorer',
    'Saga Onboarding Co-Pilot',
    'Smart Contract Doc Generator',
    'IDL → TypeScript Type Builder',
    'Solana Program Fuzzer',
    'Anchor IDL Diff Reporter',
    'Strategy Backtest Harness',
    'Squads Multisig Activity Watcher',
    'Devnet Airdrop Daemon',
  ],
  REPO: [
    'rust-svm-fuzzer',
    'anchor-typebox',
    'solana-program-test-kit',
    'jupiter-route-explorer',
    'phantom-deeplink-helpers',
    'priority-fee-auctioneer',
    'spl-token-snapshot',
    'helius-stream-tooling',
    'pyth-feed-adapter',
    'birdeye-cache-edge',
    'compute-budget-profiler',
    'tx-replay-cli',
    'idl-publisher',
    'solana-cli-shortcuts',
    'magiceden-rest-typed',
    'switchboard-poller',
    'jupiter-swap-bench',
    'compressed-nft-toolkit',
    'spl-governance-utils',
    'wallet-adapter-react-extras',
    'merkle-airdrop-builder',
    'oracle-deviation-alarms',
    'solana-validator-metrics',
  ],
  BOT: [
    'Discord Onchain Reporter',
    'Telegram PnL Bot',
    'Twitter Mention Notifier',
    'Slack On-chain Digest',
    'Reddit Mention Alerter',
    'Wallet Activity DM Bot',
  ],
  SCRIPT: [
    'mempool-watch.py',
    'wallet-balance-export.ts',
    'devnet-faucet-rotator.sh',
    'jupiter-route-quickrun.ts',
    'spl-airdrop-batch.py',
    'anchor-deploy-helper.sh',
  ],
  OTHER: [
    'Solana Dev Setup — Notion Template',
    'Anchor Cheatsheet PDF',
    'Validator Ops Runbook',
    'IDL → Markdown Generator',
    'Tx Annotator Browser Extension',
  ],
};

const TAG_POOL = [
  'solana', 'anchor', 'rust', 'typescript', 'helius', 'jupiter', 'pyth',
  'mev', 'arbitrage', 'jito', 'sniper', 'agent', 'autonomous', 'cli',
  'webhook', 'realtime', 'monitoring', 'oracle', 'liquidation', 'swap',
  'nft', 'compressed', 'magiceden', 'tensor', 'pumpfun', 'birdeye',
  'wallet', 'phantom', 'backpack', 'mainnet', 'devnet', 'fuzzing',
  'audit', 'security', 'governance', 'multisig', 'devops', 'tooling',
  'tx-decoder', 'analytics', 'webhook',
];

const REVIEW_TEXTS = [
  'works as advertised. ran it 3 weeks straight, zero crashes.',
  'good code. comments could be better but easy to follow.',
  'huge time saver, paid for itself in the first day.',
  'solid. does one thing and does it well.',
  'fast. surprisingly fast.',
  'dev was responsive when I had a question. recommended.',
  'easy install, sane defaults.',
  'better than the open source alternatives I tried.',
  'works on mainnet, didn\'t test devnet.',
  'minor setup friction with env vars but otherwise clean.',
  'caught a launch I would have missed. paid back x10.',
  '5 stars only because there\'s no 6.',
  'shipped quickly, support was prompt.',
  'solid build. would buy again.',
  null,
  null,
  null, // some reviews have no text
];

// ── Generators ──────────────────────────────────────────────────────────────

function makeUsername(used: Set<string>): string {
  for (let attempt = 0; attempt < 30; attempt++) {
    const root = pick(USERNAME_ROOTS);
    const suffix = pick(USERNAME_SUFFIXES);
    const candidate = root + suffix;
    if (!used.has(candidate)) {
      used.add(candidate);
      return candidate;
    }
  }
  // Fallback to numbered if collisions get aggressive.
  let i = 1;
  while (used.has(`builder${i}`)) i++;
  used.add(`builder${i}`);
  return `builder${i}`;
}

function makeAvatar(seed: string): string {
  return `https://api.dicebear.com/9.x/identicon/svg?seed=${encodeURIComponent(seed)}`;
}

function pickTags(): string[] {
  const n = randInt(2, 5);
  return shuffle(TAG_POOL).slice(0, n);
}

function priceForType(t: ListingType): number {
  switch (t) {
    case 'AI_AGENT':
      return randFloat(0.08, 2.5, 3);
    case 'REPO':
      return randFloat(0.02, 0.6, 3);
    case 'BOT':
      return randFloat(0.04, 0.8, 3);
    case 'SCRIPT':
      return randFloat(0.005, 0.2, 4);
    case 'OTHER':
      return randFloat(0.005, 0.4, 4);
  }
}

// ── Cleanup ─────────────────────────────────────────────────────────────────

async function clearSeedRows() {
  // Cascade-safe order: child rows first, parent last.
  // ReputationEvent has no isSeed flag — clean up by linking to seed users.
  const seedUsers = await prisma.user.findMany({
    where: { isSeed: true },
    select: { id: true },
  });
  const seedUserIds = seedUsers.map((u) => u.id);

  if (seedUserIds.length > 0) {
    await prisma.reputationEvent.deleteMany({
      where: { userId: { in: seedUserIds } },
    });
  }
  await prisma.marketReview.deleteMany({ where: { isSeed: true } });
  await prisma.marketPurchase.deleteMany({ where: { isSeed: true } });
  await prisma.marketListing.deleteMany({ where: { isSeed: true } });
  await prisma.user.deleteMany({ where: { isSeed: true } });
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('▶ Seeding demo data');
  console.log('  → clearing previous seed rows');
  await clearSeedRows();

  // 1) Users
  console.log(`  → creating ${N_USERS} users`);
  const usedUsernames = new Set<string>();
  const userIds: string[] = [];
  for (let i = 0; i < N_USERS; i++) {
    const username = makeUsername(usedUsernames);
    const u = await prisma.user.create({
      data: {
        username,
        displayName: username,
        bio: pick(BIOS) || null,
        avatarUrl: makeAvatar(username),
        walletAddress: randomWalletHex(),
        profileSetup: true,
        reputationPoints: randInt(0, 800),
        createdAt: randomDateWithinDays(180),
        isSeed: true,
      },
    });
    userIds.push(u.id);
  }

  // 2) Listings — distribute by type
  console.log(`  → creating ${N_LISTINGS} listings`);
  const listingsByType: Array<{ type: ListingType; n: number }> = TYPE_DISTRIBUTION.map(
    ([t, n]) => ({ type: t, n }),
  );
  const allListings: Array<{ id: string; price: number; sellerId: string; createdAt: Date }> = [];

  for (const { type, n } of listingsByType) {
    const titles = shuffle(LISTING_TITLES[type]);
    for (let i = 0; i < n; i++) {
      const title = titles[i % titles.length]!;
      const price = priceForType(type);
      const sellerId = pick(userIds);
      const createdAt = randomDateWithinDays(180);
      const listing = await prisma.marketListing.create({
        data: {
          title,
          description: `${title}. Battle-tested in production. ${pick(BIOS)}`,
          type,
          price,
          currency: 'ETH',
          tags: pickTags(),
          sellerId,
          status: ListingStatus.ACTIVE,
          scanPassed: true,
          createdAt,
          isSeed: true,
        },
      });
      allListings.push({ id: listing.id, price, sellerId, createdAt });
    }
  }

  // 3) Purchases — must respect [listingId, buyerId] uniqueness
  console.log(`  → creating up to ${N_PURCHASES} purchases`);
  const purchasePairs = new Set<string>();
  const createdPurchases: Array<{
    id: string;
    buyerId: string;
    listingId: string;
    sellerId: string;
    createdAt: Date;
  }> = [];

  let attempts = 0;
  while (createdPurchases.length < N_PURCHASES && attempts < N_PURCHASES * 4) {
    attempts++;
    const listing = pick(allListings);
    const buyerId = pick(userIds);
    if (buyerId === listing.sellerId) continue;
    const key = `${listing.id}::${buyerId}`;
    if (purchasePairs.has(key)) continue;
    purchasePairs.add(key);

    const createdAt = new Date(
      listing.createdAt.getTime() +
        Math.random() * Math.max(1, Date.now() - listing.createdAt.getTime()),
    );
    // Most are completed; some still in flight to feel real.
    const completed = Math.random() < 0.85;
    const status = completed ? OrderStatus.COMPLETED : OrderStatus.PENDING_DELIVERY;
    const escrowStatus = completed ? EscrowStatus.RELEASED : EscrowStatus.FUNDED;

    const amountWei = BigInt(Math.round(listing.price * 1e18)).toString();

    const p = await prisma.marketPurchase.create({
      data: {
        listingId: listing.id,
        buyerId,
        sellerId: listing.sellerId,
        txHash: '0x' + 'seed' + Math.random().toString(16).slice(2, 18).padEnd(60, '0'),
        amountWei,
        verified: true,
        status,
        escrowStatus,
        completedAt: completed ? createdAt : null,
        createdAt,
        isSeed: true,
      },
    });
    createdPurchases.push({
      id: p.id,
      buyerId,
      listingId: listing.id,
      sellerId: listing.sellerId,
      createdAt,
    });
  }

  // 4) Reviews — only on completed purchases, respect [listingId, authorId] unique
  console.log(`  → creating up to ${N_REVIEWS} reviews`);
  const reviewPairs = new Set<string>();
  let reviewsCreated = 0;
  for (const p of shuffle(createdPurchases)) {
    if (reviewsCreated >= N_REVIEWS) break;
    const key = `${p.listingId}::${p.buyerId}`;
    if (reviewPairs.has(key)) continue;
    reviewPairs.add(key);
    // ~70% of completed purchases get a review.
    if (Math.random() > 0.7) continue;
    // Rating skews positive but not all 5s.
    const rating = pickWeighted<number>([
      [5, 55],
      [4, 30],
      [3, 10],
      [2, 4],
      [1, 1],
    ]);
    await prisma.marketReview.create({
      data: {
        listingId: p.listingId,
        authorId: p.buyerId,
        rating,
        content: pick(REVIEW_TEXTS),
        createdAt: new Date(p.createdAt.getTime() + randInt(60_000, 7 * 24 * 60 * 60 * 1000)),
        isSeed: true,
      },
    });
    reviewsCreated++;
  }

  // 5) Reputation events — wire purchases/sales to reputation
  console.log('  → creating reputation events');
  for (const p of createdPurchases) {
    // buyer
    await prisma.reputationEvent.create({
      data: {
        userId: p.buyerId,
        points: 1,
        reason: ReputationReason.LISTING_PURCHASED,
        resourceId: p.listingId,
        createdAt: p.createdAt,
      },
    });
    // seller
    await prisma.reputationEvent.create({
      data: {
        userId: p.sellerId,
        points: 5,
        reason: ReputationReason.LISTING_SOLD,
        resourceId: p.listingId,
        createdAt: p.createdAt,
      },
    });
  }

  // Summary
  const stats = {
    users: await prisma.user.count({ where: { isSeed: true } }),
    listings: await prisma.marketListing.count({ where: { isSeed: true } }),
    purchases: await prisma.marketPurchase.count({ where: { isSeed: true } }),
    reviews: await prisma.marketReview.count({ where: { isSeed: true } }),
  };
  console.log('✓ done', stats);
}

main()
  .catch((e) => {
    console.error('✗ seed failed', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
