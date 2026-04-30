import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { z } from 'zod';

import { PrismaService } from '../../common/prisma/prisma.service';
import { RedisService } from '../../common/redis/redis.service';
import { isSafeUrl } from '../../common/sanitize/sanitize.util';

// Strict validation schema for price data
const PriceSchema = z.object({
  price: z.number().positive().finite(),
  volume24h: z.number().nonnegative().finite().optional(),
  marketCap: z.number().nonnegative().finite().optional(),
  change24h: z.number().finite().optional(),
});

const CACHE_TTL = 30; // seconds
const PRICE_CACHE_KEY = 'bolty_price';
const ETH_PRICE_CACHE_KEY = 'eth_usd_price';
const HISTORY_LIMIT = 288; // 24h at 5-min intervals

@Injectable()
export class ChartService {
  private readonly logger = new Logger(ChartService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async getCurrentPrice(): Promise<z.infer<typeof PriceSchema>> {
    // Check cache
    const cached = await this.redis.get(PRICE_CACHE_KEY);
    if (cached) {
      return JSON.parse(cached) as z.infer<typeof PriceSchema>;
    }

    const tokenAddress = this.config.get<string>('HAGGL_TOKEN_ADDRESS');
    const priceApiUrl = this.config.get<string>('PRICE_API_URL', 'https://price.jup.ag/v6/price');

    if (!tokenAddress) {
      // Return mock data if token not configured
      return this.getMockPrice();
    }

    try {
      const url = `${priceApiUrl}?ids=${encodeURIComponent(tokenAddress)}`;

      if (!isSafeUrl(url)) {
        throw new BadRequestException('Invalid price API URL');
      }

      const response = await axios.get(url, {
        timeout: 5000,
        headers: { 'User-Agent': 'Bolty-Platform/1.0' },
        // Limit response size to prevent memory attacks
        maxContentLength: 100 * 1024, // 100KB
      });

      const data = response.data;

      // Validate the response
      const rawPrice = data?.data?.[tokenAddress]?.price;
      if (typeof rawPrice !== 'number') {
        throw new Error('Invalid price data from API');
      }

      const priceData = PriceSchema.parse({
        price: rawPrice,
        volume24h: data?.data?.[tokenAddress]?.extraInfo?.last24hVolume,
        change24h: 0,
      });

      // Cache valid data
      await this.redis.set(PRICE_CACHE_KEY, JSON.stringify(priceData), CACHE_TTL);

      // Persist snapshot
      await this.prisma.priceSnapshot.create({
        data: {
          price: priceData.price,
          volume24h: priceData.volume24h,
          marketCap: priceData.marketCap,
          change24h: priceData.change24h,
          source: 'jupiter',
        },
      });

      return priceData;
    } catch (err) {
      this.logger.warn('Price API error, using cached/mock data', err);
      return this.getMockPrice();
    }
  }

  async getEthPrice(): Promise<{ price: number }> {
    const cached = await this.redis.get(ETH_PRICE_CACHE_KEY);
    if (cached) return JSON.parse(cached) as { price: number };

    try {
      const response = await axios.get(
        'https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd',
        {
          timeout: 5000,
          headers: { 'User-Agent': 'Bolty-Platform/1.0' },
          maxContentLength: 10 * 1024,
        },
      );
      const price = response.data?.ethereum?.usd;
      if (typeof price !== 'number' || price <= 0) throw new Error('Invalid ETH price');
      const result = { price };
      await this.redis.set(ETH_PRICE_CACHE_KEY, JSON.stringify(result), CACHE_TTL);
      return result;
    } catch (err) {
      this.logger.warn('ETH price API error, using fallback', err);
      return { price: 2000 };
    }
  }

  async getPriceHistory(hours = 24): Promise<unknown[]> {
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);

    const snapshots = await this.prisma.priceSnapshot.findMany({
      where: { createdAt: { gte: since } },
      orderBy: { createdAt: 'asc' },
      take: HISTORY_LIMIT,
      select: {
        createdAt: true,
        price: true,
        volume24h: true,
        change24h: true,
      },
    });

    if (snapshots.length < 2) {
      return this.getMockHistory(hours);
    }

    return snapshots;
  }

  private getMockPrice(): z.infer<typeof PriceSchema> {
    // Deterministic mock for development
    const base = 0.00042;
    const variance = Math.sin(Date.now() / 100000) * 0.00005;
    return PriceSchema.parse({
      price: base + variance,
      volume24h: 1250000,
      marketCap: 42000000,
      change24h: variance > 0 ? 2.4 : -1.8,
    });
  }

  private getMockHistory(hours: number): unknown[] {
    const now = Date.now();
    const base = 0.00042;
    const points = hours * 12; // every 5 min
    return Array.from({ length: points }, (_, i) => {
      const t = now - (points - i) * 5 * 60 * 1000;
      const price = base + Math.sin(t / 1000000) * 0.00008 + Math.random() * 0.00002;
      return { createdAt: new Date(t), price, volume24h: 50000 };
    });
  }
}
