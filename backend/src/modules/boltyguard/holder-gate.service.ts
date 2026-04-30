import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ethers } from 'ethers';

import { PrismaService } from '../../common/prisma/prisma.service';

const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function decimals() view returns (uint8)',
];

const BALANCE_CACHE_TTL_MS = 60_000;
const FREE_QUOTA_PER_DAY = 5; // anonymous quota — IP-bucketed in the controller

/**
 * Gates the public BoltyGuard scan API on holding a configurable
 * amount of $BOLTY. Free tier (no auth, no holding) gets a small
 * daily quota; paid tier (≥ MIN_HOLDING $BOLTY in any wallet linked
 * to the user) is unmetered.
 *
 * Reads on-chain balance with a 1-min in-memory cache so we don't
 * hammer the RPC on every scan request. No write side effects — we
 * don't require burning tokens; holding is enough.
 */
@Injectable()
export class HolderGateService {
  private readonly logger = new Logger(HolderGateService.name);
  private readonly provider: ethers.JsonRpcProvider | null;
  private readonly tokenAddress: string | null;
  private readonly minHolding: bigint;
  private readonly balanceCache = new Map<string, { balance: bigint; checkedAt: number }>();

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    // Reuse the project-wide ETH_RPC_URL convention (escrow, market,
    // rays all read it). BASE_RPC_URL is honoured as a backwards-
    // compatible alias if someone set it explicitly for BoltyGuard.
    const rpc =
      this.config.get<string>('ETH_RPC_URL') ??
      this.config.get<string>('BASE_RPC_URL') ??
      'https://mainnet.base.org';
    this.tokenAddress = this.config.get<string>('BOLTY_TOKEN_ADDRESS') ?? null;
    const minRaw = this.config.get<string>('BOLTYGUARD_MIN_HOLDING') ?? '1000';
    // Default 1,000 BOLTY in 18-decimal units. Override via env.
    this.minHolding = ethers.parseUnits(minRaw, 18);

    this.provider = rpc ? new ethers.JsonRpcProvider(rpc) : null;
  }

  /**
   * Returns whether the user has enough $BOLTY to bypass the free
   * quota. If the gate isn't configured (no RPC / token address) we
   * fail open and treat everyone as a holder — this is dev mode.
   */
  async isHolder(userId: string | null | undefined): Promise<{
    holder: boolean;
    balance: string;
    minHolding: string;
    reason?: string;
  }> {
    if (!this.provider || !this.tokenAddress) {
      return {
        holder: true,
        balance: '0',
        minHolding: '0',
        reason: 'gate_disabled',
      };
    }
    if (!userId) {
      return {
        holder: false,
        balance: '0',
        minHolding: ethers.formatUnits(this.minHolding, 18),
        reason: 'unauthenticated',
      };
    }

    const wallets = await this.prisma.user
      .findUnique({
        where: { id: userId },
        select: {
          walletAddress: true,
          linkedWallets: { select: { address: true } },
        },
      })
      .catch(() => null);

    if (!wallets) {
      return {
        holder: false,
        balance: '0',
        minHolding: ethers.formatUnits(this.minHolding, 18),
        reason: 'no_user',
      };
    }

    const addresses = [
      ...(wallets.walletAddress ? [wallets.walletAddress] : []),
      ...wallets.linkedWallets.map((w) => w.address),
    ].filter(Boolean);

    if (addresses.length === 0) {
      return {
        holder: false,
        balance: '0',
        minHolding: ethers.formatUnits(this.minHolding, 18),
        reason: 'no_wallet',
      };
    }

    // Sum balances across all linked wallets.
    let total = 0n;
    for (const addr of addresses) {
      try {
        total += await this.fetchBalance(addr);
      } catch (err) {
        this.logger.warn(`balance lookup failed for ${addr}: ${(err as Error).message}`);
      }
    }

    const holder = total >= this.minHolding;
    return {
      holder,
      balance: ethers.formatUnits(total, 18),
      minHolding: ethers.formatUnits(this.minHolding, 18),
      reason: holder ? 'ok' : 'insufficient_holding',
    };
  }

  private async fetchBalance(address: string): Promise<bigint> {
    const cached = this.balanceCache.get(address.toLowerCase());
    if (cached && Date.now() - cached.checkedAt < BALANCE_CACHE_TTL_MS) {
      return cached.balance;
    }
    const contract = new ethers.Contract(
      this.tokenAddress as string,
      ERC20_ABI,
      this.provider as ethers.JsonRpcProvider,
    );
    const raw = (await contract.balanceOf(address)) as bigint;
    this.balanceCache.set(address.toLowerCase(), {
      balance: raw,
      checkedAt: Date.now(),
    });
    return raw;
  }
}

export const FREE_TIER_DAILY_QUOTA = FREE_QUOTA_PER_DAY;
