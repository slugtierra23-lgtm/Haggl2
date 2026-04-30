import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';

import { PrismaService } from '../../common/prisma/prisma.service';
import { sanitizeText } from '../../common/sanitize/sanitize.util';

import { ChatGateway } from './chat.gateway';

// Roster of bot personas seeded into the public chat. Each row becomes a User
// row with isBot=true so bot messages are visually indistinguishable from real
// users (avatars, usernames, ranks all render normally). Avatars use DiceBear
// "bottts-neutral" seeded by username so every bot has a unique, deterministic
// robot avatar — no extra upload or storage needed.
const BOT_AVATAR = (seed: string) =>
  `https://api.dicebear.com/7.x/bottts-neutral/svg?seed=${seed}&backgroundType=gradientLinear&backgroundColor=b6e3f4,c0aede,ffdfbf`;

const BOT_PERSONAS = [
  { username: 'nyx_bot', displayName: 'Nyx Trading Bot', tag: '#0001', rep: 4200 },
  { username: 'kiara_bot', displayName: 'Kiara Research Bot', tag: '#0002', rep: 1850 },
  { username: 'hex_bot', displayName: 'Hex Code Bot', tag: '#0003', rep: 920 },
  { username: 'rune_bot', displayName: 'Rune Dev Bot', tag: '#0004', rep: 540 },
  { username: 'echo_bot', displayName: 'Echo Market Bot', tag: '#0005', rep: 280 },
  { username: 'vex_bot', displayName: 'Vex Builder Bot', tag: '#0006', rep: 130 },
  { username: 'luma_bot', displayName: 'Luma Data Bot', tag: '#0007', rep: 75 },
  { username: 'orin_bot', displayName: 'Orin Deploy Bot', tag: '#0008', rep: 30 },
  { username: 'zarak_bot', displayName: 'Zarak Audit Bot', tag: '#0009', rep: 3120 },
  { username: 'quark_bot', displayName: 'Quark Signals Bot', tag: '#0010', rep: 2480 },
];

// A small library of believable, on-brand chatter — short, lowercase, varied.
// Avoids URLs (the chat spam filter blocks them) and weird repeats.
const BOT_LINES = [
  'gm builders',
  'shipped a new agent today, finally green ci',
  'anyone else seeing the eth gas crater right now?',
  'my buyer agent just closed a 4-day negotiation, pretty wild',
  'looking for an ocr agent, paying in $HAGGL',
  'leaderboard moves fast lately',
  'who is the new dev climbing to maestria?',
  'just bought a code review bot, surprisingly good',
  'first time listing on market, any tips?',
  'the new escrow flow is super smooth',
  'tested 3 different scraping agents this week, only one held up',
  'ranked up to platino lol',
  'my repo got 12 stars overnight, wat',
  'anyone got a good tts agent?',
  'training data for bots is the bottleneck',
  'just dropped a discord moderation agent on market',
  'this rays system is addictive',
  'bought an agent that writes prisma migrations, saves me hours',
  'wen $HAGGL listings on cex',
  'the boost button works great, my listing got 3x impressions',
  'rate-limit on dms is a bit aggressive imo',
  'just finished a 6h build session, brain melted',
  'top sold agent this week is fire',
  'anyone want to collab on a dataset cleaner agent?',
  'love the new ticker bar at the top',
  'bro the leaderboard animation is sick',
  'just ranked up to oro 🟡',
  'who else hyped for the v2 escrow contract?',
  'i would pay good $HAGGL for a perfect calendar agent',
  'bots are the future of indie hacking',
  'what is your daily agent stack?',
  'tested deepseek vs claude for code reviews, both solid',
  'first sale on market, lfg',
  'any beta testers for my new agent?',
  'this chat is wild today',
  'building in public is the way',
  'ranked up to diamante after that boost campaign',
  'the new /market/repos page looks clean',
  'shipping is the only thing that matters',
  'agent marketplaces are the next steam',
  // Launch-hype lines (HAGGL going live on Base)
  '$HAGGL is live on base, lets gooo',
  'just bought my first repo with $HAGGL, 3% fee is 🔥',
  'payed in $HAGGL vs eth, saved like 4% on a 200 dollar listing',
  'chart looking juicy rn 🟣',
  'who else aped into $HAGGL',
  'the fee cut is the real alpha, why would anyone pay 7% in eth again',
  'loading more $HAGGL before volume catches up',
  'pay-with-haggl toggle on repos is clean ui',
  'ticker showing nonstop trades, nice',
  'ape signal: $HAGGL',
  'seller just got paid 97% in $HAGGL, marketplaces ate',
  'CA bookmarked, im holding',
  'fair launch with no vc unlocks is underrated',
  'liquidity looking healthy',
  'haggl marketplace + $HAGGL token, wheres the catch',
  'refreshing every 30s to watch the tape',
  'first sale paid in $HAGGL feels historic lol',
];

const TICK_MS = 7_000; // try to post every 7s on average (launch-day cadence)
const MIN_POST_GAP_MS = 35_000; // each individual bot waits >= 35s between posts
const POST_PROBABILITY = 0.7; // 70% chance per tick that some bot posts
const MAX_RECENT = 80; // never re-use a line until at least 80 messages later

@Injectable()
export class ChatBotService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ChatBotService.name);
  private timer: NodeJS.Timeout | null = null;
  private lastPostByBot = new Map<string, number>();
  private recentLines: string[] = [];
  private botUserIds: string[] = [];

  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: ChatGateway,
  ) {}

  async onModuleInit() {
    // Seeding is idempotent — safe to run on every cold start.
    if (process.env.CHAT_BOTS_DISABLED === '1') {
      this.logger.log('Chat bots disabled via CHAT_BOTS_DISABLED=1');
      return;
    }
    try {
      await this.seedBots();
      this.timer = setInterval(() => this.tick().catch(() => {}), TICK_MS);
      this.timer.unref?.();
      this.logger.log(`Chat bots online — ${this.botUserIds.length} personas seeded`);
    } catch (err) {
      this.logger.error('Bot seeder failed', err as Error);
    }
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private async seedBots() {
    const ids: string[] = [];
    for (const p of BOT_PERSONAS) {
      const avatarUrl = BOT_AVATAR(p.username);
      const user = await this.prisma.user.upsert({
        where: { username: p.username },
        // Keep avatar + displayName in sync on every boot so tweaks to the
        // BOT_PERSONAS roster propagate without a manual DB reset.
        update: {
          isBot: true,
          avatarUrl,
          displayName: p.displayName,
          bio: 'haggl trading bot',
        },
        create: {
          username: p.username,
          displayName: p.displayName,
          userTag: p.tag,
          isBot: true,
          reputationPoints: p.rep,
          profileSetup: true,
          avatarUrl,
          bio: 'haggl trading bot',
        },
        select: { id: true },
      });
      ids.push(user.id);
    }
    this.botUserIds = ids;
  }

  private pickLine(): string {
    // Prefer lines we haven't used recently
    const pool = BOT_LINES.filter((l) => !this.recentLines.includes(l));
    const line =
      pool.length > 0
        ? pool[Math.floor(Math.random() * pool.length)]
        : BOT_LINES[Math.floor(Math.random() * BOT_LINES.length)];
    this.recentLines.push(line);
    if (this.recentLines.length > MAX_RECENT) this.recentLines.shift();
    return line;
  }

  private async tick() {
    if (this.botUserIds.length === 0) return;
    // Probability per tick that *any* bot posts — keeps cadence chatty but not spammy.
    if (Math.random() > POST_PROBABILITY) return;

    const now = Date.now();
    const eligible = this.botUserIds.filter((id) => {
      const last = this.lastPostByBot.get(id) ?? 0;
      return now - last >= MIN_POST_GAP_MS;
    });
    if (eligible.length === 0) return;

    const userId = eligible[Math.floor(Math.random() * eligible.length)];
    const content = sanitizeText(this.pickLine());
    this.lastPostByBot.set(userId, now);

    try {
      const message = await this.prisma.chatMessage.create({
        data: { content, userId },
        include: {
          user: { select: { username: true, avatarUrl: true, reputationPoints: true } },
        },
      });
      // Push directly to the gateway (bypasses ChatService rate limiter — bots
      // already respect their own per-bot cooldown above).
      this.gateway.server?.emit('newMessage', {
        id: message.id,
        content: message.content,
        userId: message.userId,
        username: message.user.username,
        avatarUrl: message.user.avatarUrl,
        reputationPoints: message.user.reputationPoints,
        createdAt: message.createdAt,
      });
    } catch (err) {
      this.logger.warn(`Bot post failed: ${(err as Error).message}`);
    }
  }
}
