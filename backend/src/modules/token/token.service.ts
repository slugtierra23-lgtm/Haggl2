import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';

import { RedisService } from '../../common/redis/redis.service';

/**
 * HAGGL token contract on Base. Deployed via Flaunch, tradable on
 * Uniswap V4 (which Flaunch is built on).
 */
export const HAGGL_CONTRACT = '0xA383e85a626171edCB2727AEcAED4Fc5e27E42a7';
export const HAGGL_CHAIN = 'base';

const CACHE_TTL_SEC = 60;
const CACHE_KEY = 'token:bolty:stats:v1';
// Trades refresh more often — the UI promises a live feed.
const TRADES_CACHE_TTL_SEC = 4;
const TRADES_CACHE_KEY = 'token:bolty:trades:v1';
const OHLCV_CACHE_TTL_SEC = 60;
// Long-lived "last good" copy so a GeckoTerminal rate-limit / 503 / timeout
// doesn't leave the chart blank. We always serve the fresh entry first,
// fall back to this only when the upstream call fails outright. Keep it
// long enough to survive a sustained upstream outage (1h).
const OHLCV_STALE_CACHE_TTL_SEC = 3600;
const OHLCV_CACHE_KEY = 'token:bolty:ohlcv:v1';
const OHLCV_STALE_KEY = 'token:bolty:ohlcv:v1:stale';

/** Shape we expose to the frontend — curated from DexScreener pair data. */
export interface TokenStats {
  contract: string;
  chain: string;
  symbol: string;
  name: string;
  imageUrl: string | null;
  priceUsd: number | null;
  priceChange24h: number | null; // percent
  priceChange1h: number | null;
  priceChange6h: number | null;
  volume24hUsd: number | null;
  liquidityUsd: number | null;
  fdvUsd: number | null;
  marketCapUsd: number | null;
  pairAddress: string | null; // for chart embed
  pairUrl: string | null;
  dexId: string | null;
  flaunchUrl: string;
  ethPriceUsd: number | null; // derived from priceUsd/priceNative
  updatedAt: string;
}

interface DexScreenerPair {
  chainId: string;
  dexId: string;
  pairAddress: string;
  url: string;
  priceUsd?: string;
  priceNative?: string;
  priceChange?: { h1?: number; h6?: number; h24?: number };
  volume?: { h24?: number };
  liquidity?: { usd?: number };
  fdv?: number;
  marketCap?: number;
  baseToken: { address: string; name: string; symbol: string };
  info?: { imageUrl?: string };
}

interface DexScreenerResponse {
  pairs?: DexScreenerPair[] | null;
}

export interface BoltyCandle {
  t: number; // unix seconds
  o: number;
  h: number;
  l: number;
  c: number;
  v: number; // volume USD
}

export interface BoltyTrade {
  id: string;
  side: 'buy' | 'sell';
  priceUsd: number | null;
  amountUsd: number | null;
  amountToken: number | null;
  amountEth: number | null;
  txHash: string;
  wallet: string;
  at: string; // ISO
}

interface GeckoTerminalTradeAttrs {
  block_number?: number;
  tx_hash: string;
  tx_from_address: string;
  from_token_address?: string;
  to_token_address?: string;
  from_token_amount?: string | number;
  to_token_amount?: string | number;
  price_from_in_currency_token?: string | number;
  price_to_in_currency_token?: string | number;
  price_from_in_usd?: string | number;
  price_to_in_usd?: string | number;
  block_timestamp: string;
  kind?: 'buy' | 'sell' | string;
  volume_in_usd?: string | number;
}

interface GeckoTerminalTradesResponse {
  data?: Array<{ id: string; type: string; attributes: GeckoTerminalTradeAttrs }>;
}

interface GeckoTerminalOhlcvResponse {
  data?: {
    attributes?: {
      // rows shape: [timestamp, open, high, low, close, volume]
      ohlcv_list?: Array<[number, number, number, number, number, number]>;
    };
  };
}

@Injectable()
export class TokenService {
  private readonly logger = new Logger(TokenService.name);

  constructor(private readonly redis: RedisService) {}

  async getBoltyStats(): Promise<TokenStats> {
    const cached = await this.redis.get(CACHE_KEY).catch(() => null);
    if (cached) {
      try {
        return JSON.parse(cached) as TokenStats;
      } catch {
        /* fall through and refetch */
      }
    }

    const fresh = await this.fetchFromDexScreener().catch((err) => {
      this.logger.warn(`DexScreener fetch failed: ${(err as Error).message}`);
      return null;
    });

    const stats: TokenStats = fresh ?? this.fallback();
    await this.redis.set(CACHE_KEY, JSON.stringify(stats), CACHE_TTL_SEC).catch(() => void 0);
    return stats;
  }

  private async fetchFromDexScreener(): Promise<TokenStats | null> {
    const url = `https://api.dexscreener.com/latest/dex/tokens/${HAGGL_CONTRACT}`;
    const res = await axios.get<DexScreenerResponse>(url, {
      timeout: 6000,
      headers: { Accept: 'application/json' },
      validateStatus: (s) => s >= 200 && s < 300,
      maxRedirects: 0,
    });
    const pairs = (res.data?.pairs ?? []).filter((p) => p.chainId === HAGGL_CHAIN);
    if (pairs.length === 0) return null;

    // Pick the pair with the deepest liquidity — DexScreener returns
    // every pair the token trades in (v2 + v3 + v4), some of which are
    // shallow or test pools.
    pairs.sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0));
    const p = pairs[0];

    const priceUsd = p.priceUsd != null ? Number(p.priceUsd) : null;
    const priceNative = p.priceNative != null ? Number(p.priceNative) : null;
    const ethPriceUsd =
      priceUsd != null && priceNative != null && priceNative > 0 ? priceUsd / priceNative : null;

    return {
      contract: HAGGL_CONTRACT,
      chain: HAGGL_CHAIN,
      symbol: p.baseToken.symbol,
      name: p.baseToken.name,
      imageUrl: p.info?.imageUrl ?? null,
      priceUsd,
      priceChange24h: p.priceChange?.h24 ?? null,
      priceChange1h: p.priceChange?.h1 ?? null,
      priceChange6h: p.priceChange?.h6 ?? null,
      volume24hUsd: p.volume?.h24 ?? null,
      liquidityUsd: p.liquidity?.usd ?? null,
      fdvUsd: p.fdv ?? null,
      marketCapUsd: p.marketCap ?? null,
      pairAddress: p.pairAddress,
      pairUrl: p.url,
      dexId: p.dexId,
      flaunchUrl: `https://flaunch.gg/base/coin/${HAGGL_CONTRACT}`,
      ethPriceUsd,
      updatedAt: new Date().toISOString(),
    };
  }

  /**
   * OHLCV candles for the native chart. We fetch GeckoTerminal's
   * minute aggregates directly (JSON) and let the client render
   * them with lightweight-charts — our CSP blocks external iframes.
   */
  async getBoltyOhlcv(
    timeframe: 'minute' | 'hour' | 'day' = 'minute',
    aggregate = 1,
    limit = 300,
  ): Promise<BoltyCandle[]> {
    const key = `${OHLCV_CACHE_KEY}:${timeframe}:${aggregate}:${limit}`;
    const staleKey = `${OHLCV_STALE_KEY}:${timeframe}:${aggregate}:${limit}`;
    const cached = await this.redis.get(key).catch(() => null);
    if (cached) {
      try {
        return JSON.parse(cached) as BoltyCandle[];
      } catch {
        /* fall through */
      }
    }

    const stats = await this.getBoltyStats();
    if (!stats.pairAddress) {
      // No pair yet — fall back to the last-good copy if we ever had
      // one (e.g. DexScreener temporarily blank). Empty array as last
      // resort so the FE shows "still indexing".
      const stale = await this.redis.get(staleKey).catch(() => null);
      if (stale) {
        try {
          return JSON.parse(stale) as BoltyCandle[];
        } catch {
          /* corrupt — give up */
        }
      }
      return [];
    }

    let candles: BoltyCandle[] | null = null;
    try {
      candles = await this.fetchOhlcv(stats.pairAddress, timeframe, aggregate, limit);
    } catch (err) {
      this.logger.warn(`OHLCV fetch failed: ${(err as Error).message}`);
    }

    if (candles && candles.length > 0) {
      // Fresh + stale both written: fresh expires fast, stale lives for
      // an hour so the next rate-limited tick still has something.
      await Promise.all([
        this.redis.set(key, JSON.stringify(candles), OHLCV_CACHE_TTL_SEC).catch(() => null),
        this.redis
          .set(staleKey, JSON.stringify(candles), OHLCV_STALE_CACHE_TTL_SEC)
          .catch(() => null),
      ]);
      return candles;
    }

    // Upstream failed or returned empty. Serve last-good copy if we
    // have one — chart stays populated through transient GeckoTerminal
    // 429s instead of going blank.
    const stale = await this.redis.get(staleKey).catch(() => null);
    if (stale) {
      try {
        return JSON.parse(stale) as BoltyCandle[];
      } catch {
        /* corrupt — give up */
      }
    }
    return candles ?? [];
  }

  /**
   * Generic GeckoTerminal OHLCV proxy for any Base pool. Same
   * caching shape as Bolty's chart — fresh 60 s, stale 1 h — but
   * keyed per pool address so each launchpad token has its own
   * sliding window. Empty arrays are NOT cached (tokens that haven't
   * traded yet should be re-checked next tick rather than locked into
   * "no candles" for 60 s).
   */
  async getCoinOhlcv(
    poolAddress: string,
    timeframe: 'minute' | 'hour' | 'day' = 'minute',
    aggregate = 1,
    limit = 300,
  ): Promise<BoltyCandle[]> {
    const safePool = poolAddress.toLowerCase().replace(/[^0-9a-fx]/g, '');
    if (!safePool || safePool.length < 10) return [];
    const key = `token:coin:ohlcv:v1:${safePool}:${timeframe}:${aggregate}:${limit}`;
    const staleKey = `${key}:stale`;
    const cached = await this.redis.get(key).catch(() => null);
    if (cached) {
      try {
        return JSON.parse(cached) as BoltyCandle[];
      } catch {
        /* fall through */
      }
    }

    let candles: BoltyCandle[] | null = null;
    try {
      candles = await this.fetchOhlcv(safePool, timeframe, aggregate, limit);
    } catch (err) {
      this.logger.warn(`coin OHLCV fetch failed (${safePool}): ${(err as Error).message}`);
    }

    if (candles && candles.length > 0) {
      await Promise.all([
        this.redis.set(key, JSON.stringify(candles), OHLCV_CACHE_TTL_SEC).catch(() => null),
        this.redis
          .set(staleKey, JSON.stringify(candles), OHLCV_STALE_CACHE_TTL_SEC)
          .catch(() => null),
      ]);
      return candles;
    }

    // Upstream failed or returned empty. Serve last-good if we have it
    // — keeps the chart populated through transient GeckoTerminal 429s.
    const stale = await this.redis.get(staleKey).catch(() => null);
    if (stale) {
      try {
        return JSON.parse(stale) as BoltyCandle[];
      } catch {
        /* corrupt — fall through */
      }
    }
    return candles ?? [];
  }

  private async fetchOhlcv(
    pairAddress: string,
    timeframe: string,
    aggregate: number,
    limit: number,
  ): Promise<BoltyCandle[]> {
    const url = `https://api.geckoterminal.com/api/v2/networks/base/pools/${pairAddress}/ohlcv/${timeframe}?aggregate=${aggregate}&limit=${Math.min(limit, 1000)}&currency=usd`;
    const res = await axios.get<GeckoTerminalOhlcvResponse>(url, {
      timeout: 6000,
      headers: { Accept: 'application/json' },
      validateStatus: (s) => s >= 200 && s < 300,
      maxRedirects: 0,
    });
    const rows = res.data?.data?.attributes?.ohlcv_list ?? [];
    // GeckoTerminal returns rows newest-first; lightweight-charts
    // needs ascending by time, so we reverse here.
    return rows
      .map(
        ([t, o, h, l, c, v]): BoltyCandle => ({
          t,
          o,
          h,
          l,
          c,
          v,
        }),
      )
      .reverse();
  }

  /**
   * Offline placeholder used when DexScreener is unreachable or the
   * pair hasn't been indexed yet. The frontend renders this shape the
   * same way — with empty stats — and surfaces a "Trade on Flaunch"
   * CTA so users can still reach the token.
   */
  /**
   * Recent swaps on the deepest-liquidity HAGGL pool. Backed by
   * GeckoTerminal which publishes per-pool trade history for free —
   * DexScreener charges for this. Cached 4s so the live feed can hit
   * this endpoint aggressively without proxying every user to the
   * upstream API.
   */
  async getBoltyTrades(): Promise<BoltyTrade[]> {
    const cached = await this.redis.get(TRADES_CACHE_KEY).catch(() => null);
    if (cached) {
      try {
        return JSON.parse(cached) as BoltyTrade[];
      } catch {
        /* fall through */
      }
    }

    const stats = await this.getBoltyStats();
    if (!stats.pairAddress) return [];

    const trades = await this.fetchTrades(stats.pairAddress).catch((err) => {
      this.logger.warn(`GeckoTerminal trades fetch failed: ${(err as Error).message}`);
      return [] as BoltyTrade[];
    });

    await this.redis
      .set(TRADES_CACHE_KEY, JSON.stringify(trades), TRADES_CACHE_TTL_SEC)
      .catch(() => void 0);
    return trades;
  }

  private async fetchTrades(pairAddress: string): Promise<BoltyTrade[]> {
    const url = `https://api.geckoterminal.com/api/v2/networks/base/pools/${pairAddress}/trades?trade_volume_in_usd_greater_than=0`;
    const res = await axios.get<GeckoTerminalTradesResponse>(url, {
      timeout: 6000,
      headers: { Accept: 'application/json' },
      validateStatus: (s) => s >= 200 && s < 300,
      maxRedirects: 0,
    });
    const rows = res.data?.data ?? [];
    return rows.slice(0, 30).map((r) => {
      const a = r.attributes;
      const side =
        a.kind === 'buy' || a.kind === 'sell'
          ? a.kind
          : a.from_token_address?.toLowerCase() === HAGGL_CONTRACT.toLowerCase()
            ? 'sell'
            : 'buy';
      return {
        id: r.id,
        side,
        priceUsd: a.price_to_in_usd != null ? Number(a.price_to_in_usd) : null,
        amountUsd: a.volume_in_usd != null ? Number(a.volume_in_usd) : null,
        amountToken: a.to_token_amount != null ? Number(a.to_token_amount) : null,
        amountEth: a.from_token_amount != null ? Number(a.from_token_amount) : null,
        txHash: a.tx_hash,
        wallet: a.tx_from_address,
        at: a.block_timestamp,
      };
    });
  }

  private fallback(): TokenStats {
    return {
      contract: HAGGL_CONTRACT,
      chain: HAGGL_CHAIN,
      symbol: 'HAGGL',
      name: 'Bolty',
      imageUrl: null,
      priceUsd: null,
      priceChange24h: null,
      priceChange1h: null,
      priceChange6h: null,
      volume24hUsd: null,
      liquidityUsd: null,
      fdvUsd: null,
      marketCapUsd: null,
      pairAddress: null,
      pairUrl: null,
      dexId: null,
      flaunchUrl: `https://flaunch.gg/base/coin/${HAGGL_CONTRACT}`,
      ethPriceUsd: null,
      updatedAt: new Date().toISOString(),
    };
  }
}
