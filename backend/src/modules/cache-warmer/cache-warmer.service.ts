import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { MarketService } from '../market/market.service';
import { ReposService } from '../repos/repos.service';
import { TokenService } from '../token/token.service';

/**
 * Hot-cache warmer.
 *
 * The hot read endpoints already use Redis (TTL 30-300s). The first
 * request after a cache entry expires still pays the DB hit (~50-200ms)
 * which becomes visible to whichever unlucky user lands first.
 *
 * This cron rehydrates each entry every 4 min, so the cache window
 * (5 min for market listings, 30s for repos, etc.) never actually
 * runs out from a real user's perspective. Real users always hit a
 * warm cache; the DB hit is paid by the cron, not by them.
 *
 * Calls go through the services directly (not via HTTP) so the cache
 * keys match exactly what the controllers populate. Each call is
 * wrapped in its own try/catch — one slow external upstream
 * (DexScreener for token stats) shouldn't sink the rest.
 *
 * Disabled in non-prod by default to avoid noisy local logs; flip
 * CACHE_WARMER_ENABLED=1 if you want it locally.
 */
@Injectable()
export class CacheWarmerService implements OnModuleInit {
  private readonly logger = new Logger(CacheWarmerService.name);
  private readonly enabled: boolean;

  constructor(
    private readonly market: MarketService,
    private readonly repos: ReposService,
    private readonly token: TokenService,
  ) {
    const flag = process.env.CACHE_WARMER_ENABLED;
    this.enabled =
      flag === '1' ||
      flag === 'true' ||
      (flag === undefined && process.env.NODE_ENV === 'production');
  }

  async onModuleInit() {
    if (!this.enabled) {
      this.logger.log('disabled (set CACHE_WARMER_ENABLED=1 to force-enable)');
      return;
    }
    // Prime once at boot so the first user after deploy doesn't pay
    // the cold-cache penalty.
    setTimeout(() => {
      this.warm().catch((err) => this.logger.warn(`boot prime failed: ${err}`));
    }, 5_000);
  }

  @Cron(CronExpression.EVERY_5_MINUTES)
  async tick() {
    if (!this.enabled) return;
    await this.warm();
  }

  private async warm() {
    const started = Date.now();
    const tasks: Array<{ name: string; fn: () => Promise<unknown> }> = [
      // Marketplace landing — /market
      {
        name: 'market:all:recent',
        fn: () => this.market.getListings({ page: 1, sortBy: 'recent' }),
      },
      // /market/agents
      {
        name: 'market:agents:recent',
        fn: () => this.market.getListings({ type: 'AI_AGENT', page: 1, sortBy: 'recent' }),
      },
      // /market/repos
      {
        name: 'market:repos:recent',
        fn: () => this.market.getListings({ type: 'REPO', page: 1, sortBy: 'recent' }),
      },
      // /market/sellers
      { name: 'market:top-sellers', fn: () => this.market.getTopSellers(48) },
      // /market/leaderboard
      { name: 'market:leaderboard', fn: () => this.market.getLeaderboard() },
      // /repos (the standalone repos page)
      {
        name: 'repos:list:recent',
        fn: () => this.repos.listRepositories({ page: 1, sortBy: 'recent' }),
      },
      // /bolty token page header stats
      { name: 'token:bolty:stats', fn: () => this.token.getBoltyStats() },
    ];

    let ok = 0;
    let failed = 0;
    await Promise.all(
      tasks.map(async ({ name, fn }) => {
        try {
          await fn();
          ok += 1;
        } catch (err) {
          failed += 1;
          this.logger.warn(`warm '${name}' failed: ${(err as Error).message}`);
        }
      }),
    );
    const ms = Date.now() - started;
    this.logger.log(
      `warmed ${ok}/${tasks.length} hot caches in ${ms}ms${failed ? ` (${failed} failed)` : ''}`,
    );
  }
}
