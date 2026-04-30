import { Controller, Get, Header, Param, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';

import { Public } from '../../common/decorators/public.decorator';

import { TokenService } from './token.service';

@Controller('token')
export class TokenController {
  constructor(private readonly tokenService: TokenService) {}

  /**
   * Public — the HAGGL token page on the landing site needs to load
   * price data for unauthenticated visitors. The service caches to
   * Redis for 60s so this is cheap.
   */
  @Public()
  @Throttle({ default: { limit: 60, ttl: 60000 } })
  @Header('Cache-Control', 'public, s-maxage=20, stale-while-revalidate=60')
  @Get('haggl')
  getHaggl() {
    return this.tokenService.getHagglStats();
  }

  /**
   * Recent trade feed for the HAGGL page — last ~30 swaps with side,
   * USD size, and tx hash. Served public so unauthed visitors see the
   * live tape. Backend caches for 4s so hammering this endpoint from
   * a client polling loop doesn't pierce GeckoTerminal's rate limit.
   */
  @Public()
  @Throttle({ default: { limit: 180, ttl: 60000 } })
  @Header('Cache-Control', 'public, s-maxage=5, stale-while-revalidate=15')
  @Get('haggl/trades')
  getHagglTrades() {
    return this.tokenService.getHagglTrades();
  }

  /**
   * OHLCV candles for the /haggl native chart. Timeframe + aggregate
   * map to GeckoTerminal's pool-level OHLCV endpoint. Cached 15s so
   * the client-side poll loop (every ~10s while the tab is visible)
   * mostly hits Redis.
   */
  @Public()
  @Throttle({ default: { limit: 120, ttl: 60000 } })
  @Header('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=120')
  @Get('haggl/ohlcv')
  getHagglOhlcv(
    @Query('timeframe') timeframe?: 'minute' | 'hour' | 'day',
    @Query('aggregate') aggregate?: string,
    @Query('limit') limit?: string,
  ) {
    const tf: 'minute' | 'hour' | 'day' =
      timeframe === 'hour' || timeframe === 'day' ? timeframe : 'minute';
    const agg = Math.max(1, Math.min(Number(aggregate) || 1, 60));
    const lim = Math.max(30, Math.min(Number(limit) || 300, 1000));
    return this.tokenService.getHagglOhlcv(tf, agg, lim);
  }

  /**
   * OHLCV candles for any Base pool — used by the launchpad coin chart.
   * Previously the FE hit GeckoTerminal directly from the browser, so
   * each open chart minted its own request. With dozens of users
   * watching different tokens, those requests fan out and tip the
   * public mainnet rate limit, which is why launchpad charts kept
   * "loading 1 candle". This proxies through the backend so we get
   * shared Redis caching + a stale-fallback when the upstream dies.
   */
  @Public()
  @Throttle({ default: { limit: 240, ttl: 60000 } })
  @Header('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=120')
  @Get('coin/:pool/ohlcv')
  getCoinOhlcv(
    @Param('pool') pool: string,
    @Query('timeframe') timeframe?: 'minute' | 'hour' | 'day',
    @Query('aggregate') aggregate?: string,
    @Query('limit') limit?: string,
  ) {
    const tf: 'minute' | 'hour' | 'day' =
      timeframe === 'hour' || timeframe === 'day' ? timeframe : 'minute';
    const agg = Math.max(1, Math.min(Number(aggregate) || 1, 60));
    const lim = Math.max(30, Math.min(Number(limit) || 300, 1000));
    return this.tokenService.getCoinOhlcv(pool, tf, agg, lim);
  }
}
