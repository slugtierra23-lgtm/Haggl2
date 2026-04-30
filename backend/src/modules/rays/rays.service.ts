import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AgentRank, RaysPack, PurchaseStatus } from '@prisma/client';
import { ethers } from 'ethers';

import { PrismaService } from '../../common/prisma/prisma.service';

interface RaysPackConfig {
  pack: RaysPack;
  rays: number;
  hagglPrice: number; // in HAGGL
}

@Injectable()
export class RaysService {
  private readonly logger = new Logger(RaysService.name);

  // Pack configurations
  private readonly PACKS: RaysPackConfig[] = [
    { pack: RaysPack.PACK_10, rays: 10, hagglPrice: 12 },
    { pack: RaysPack.PACK_25, rays: 25, hagglPrice: 28 },
    { pack: RaysPack.PACK_50, rays: 50, hagglPrice: 48 },
    { pack: RaysPack.PACK_120, rays: 120, hagglPrice: 110 },
    { pack: RaysPack.PACK_250, rays: 250, hagglPrice: 230 },
  ];

  // Rank configurations (rays needed for each rank)
  private readonly RANK_REQUIREMENTS: Record<AgentRank, number> = {
    HIERRO: 0,
    BRONCE: 25,
    PLATA: 50,
    ORO: 120,
    PLATINO: 250,
    DIAMANTE: 500,
    MAESTRIA: 1000,
    CAMPEON: 2000, // Only for top 5
  };

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Get available packs
   */
  getPacks() {
    return this.PACKS;
  }

  /**
   * Get pack by type
   */
  getPackConfig(pack: RaysPack): RaysPackConfig {
    const config = this.PACKS.find((p) => p.pack === pack);
    if (!config) throw new BadRequestException('Invalid pack');
    return config;
  }

  /**
   * Purchase rays for an agent
   * SECURITY: Requires on-chain payment verification
   * - Accepts txHash (blockchain transaction)
   * - Verifies transaction succeeded and amount matches pack price
   * - Only marks as COMPLETED after verification
   */
  async purchaseRays(
    userId: string,
    agentId: string,
    pack: RaysPack,
    txHash: string,
    _amountWei: string,
  ) {
    const packConfig = this.getPackConfig(pack);

    // Verify agent exists and belongs to user
    const agent = await this.prisma.agent.findUnique({
      where: { id: agentId },
    });

    if (!agent) throw new BadRequestException('Agent not found');
    if (agent.userId !== userId) throw new BadRequestException('Not authorized');

    // Check txHash not already used (prevent replay attacks)
    const existingPurchase = await this.prisma.raysPurchase.findFirst({
      where: { AND: [{ userId }, { txHash }] },
    });
    if (existingPurchase) {
      throw new BadRequestException(
        'This transaction has already been recorded for a Rays purchase',
      );
    }

    // ── Verify blockchain transaction ────────────────────────────────────
    const rpcUrl = this.config.get<string>('ETH_RPC_URL', 'https://mainnet.base.org');
    const paymentWallet = this.config.get<string>('PAYMENT_WALLET', '');

    if (!paymentWallet) {
      throw new BadRequestException('Payment wallet not configured');
    }

    try {
      const provider = new ethers.JsonRpcProvider(rpcUrl);
      const receipt = await provider.getTransactionReceipt(txHash);

      // Verify transaction succeeded
      if (!receipt || receipt.status !== 1) {
        throw new BadRequestException('Transaction failed or not found on blockchain');
      }

      const tx = await provider.getTransaction(txHash);
      if (!tx) throw new BadRequestException('Transaction not found');

      // Verify payment was sent to correct wallet
      if (tx.to?.toLowerCase() !== paymentWallet.toLowerCase()) {
        throw new BadRequestException('Payment was not sent to the correct wallet');
      }

      // Verify amount matches pack price (in HAGGL wei)
      const expectedAmountWei = ethers.parseEther(packConfig.hagglPrice.toString());
      if (tx.value !== expectedAmountWei) {
        throw new BadRequestException(
          `Payment amount mismatch. Expected ${expectedAmountWei}, received ${tx.value}`,
        );
      }
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      throw new BadRequestException(`Blockchain verification failed: ${(err as Error).message}`);
    }

    // Create purchase record with COMPLETED status (verification succeeded)
    const purchase = await this.prisma.raysPurchase.create({
      data: {
        userId,
        agentId,
        raysPack: pack,
        raysAmount: packConfig.rays,
        boltyAmount: packConfig.hagglPrice.toString(),
        txHash,
        status: PurchaseStatus.COMPLETED,
      },
    });

    // Update agent rays
    await this.addRaysToAgent(agentId, packConfig.rays);

    return purchase;
  }

  /**
   * Add rays to agent and update rank if needed
   */
  private async addRaysToAgent(agentId: string, rays: number) {
    // Get or create agent rays record
    let agentRays = await this.prisma.agentRays.findUnique({
      where: { agentId },
    });

    if (!agentRays) {
      agentRays = await this.prisma.agentRays.create({
        data: {
          agentId,
          totalRaysAccumulated: rays,
          currentRank: this.getRankForRays(rays),
        },
      });
    } else {
      const previousRank = agentRays.currentRank;
      const newTotal = agentRays.totalRaysAccumulated + rays;
      const newRank = this.getRankForRays(newTotal);

      // Update rays
      agentRays = await this.prisma.agentRays.update({
        where: { agentId },
        data: {
          totalRaysAccumulated: newTotal,
          currentRank: newRank,
          lastRankUpAt: newRank !== previousRank ? new Date() : undefined,
        },
      });

      // Record rank history if rank changed
      if (newRank !== previousRank) {
        await this.prisma.rankHistory.create({
          data: {
            agentRaysId: agentRays.id,
            previousRank,
            newRank,
            totalRaysAt: newTotal,
          },
        });

        this.logger.log(`Agent ${agentId} ranked up from ${previousRank} to ${newRank}`);
      }
    }
  }

  /**
   * Calculate rank based on total rays
   */
  private getRankForRays(totalRays: number): AgentRank {
    const ranks = Object.entries(this.RANK_REQUIREMENTS).sort((a, b) => b[1] - a[1]);

    for (const [rank, required] of ranks) {
      if (totalRays >= required) {
        return rank as AgentRank;
      }
    }

    return AgentRank.HIERRO;
  }

  /**
   * Get agent rays info
   */
  async getAgentRays(agentId: string) {
    let agentRays = await this.prisma.agentRays.findUnique({
      where: { agentId },
      include: {
        rankHistory: {
          orderBy: { createdAt: 'desc' },
          take: 10,
        },
      },
    });

    if (!agentRays) {
      // Create default if doesn't exist
      agentRays = await this.prisma.agentRays.create({
        data: {
          agentId,
          totalRaysAccumulated: 0,
          currentRank: AgentRank.HIERRO,
        },
        include: { rankHistory: true },
      });
    }

    return agentRays;
  }

  /**
   * Get rays leaderboard (by accumulated rays)
   */
  async getRaysLeaderboard(limit = 50) {
    const leaderboard = await this.prisma.agentRays.findMany({
      include: {
        agent: {
          select: {
            id: true,
            name: true,
            user: {
              select: {
                id: true,
                username: true,
              },
            },
          },
        },
      },
      orderBy: {
        totalRaysAccumulated: 'desc',
      },
      take: limit,
    });

    return leaderboard.map((item, index) => ({
      position: index + 1,
      agent: item.agent.name,
      agentId: item.agent.id,
      creator: item.agent.user?.username || 'Unknown',
      totalRays: item.totalRaysAccumulated,
      rank: item.currentRank,
    }));
  }

  /**
   * Get creadores leaderboard
   * Based on: average sales per agent, total sales, successful sales
   */
  async getCreatorsLeaderboard(limit = 50) {
    const creators = await this.prisma.user.findMany({
      select: {
        id: true,
        username: true,
        displayName: true,
        aiAgents: {
          select: {
            id: true,
            name: true,
            rays: {
              select: {
                totalRaysAccumulated: true,
              },
            },
          },
        },
      },
    });

    // Calculate metrics
    const creatorMetrics = creators
      .map((creator) => {
        const agents = creator.aiAgents;
        if (agents.length === 0) return null;

        const totalRays = agents.reduce(
          (sum, agent) => sum + (agent.rays?.totalRaysAccumulated || 0),
          0,
        );
        const avgRaysPerAgent = totalRays / agents.length;

        return {
          creator: creator.username || creator.displayName || 'Unknown',
          creatorId: creator.id,
          agentsCount: agents.length,
          totalRays,
          avgRaysPerAgent: Math.round(avgRaysPerAgent),
        };
      })
      .filter((item) => item !== null)
      .sort((a, b) => b.totalRays - a.totalRays)
      .slice(0, limit)
      .map((item, index) => ({
        position: index + 1,
        ...item,
      }));

    return creatorMetrics;
  }

  /**
   * Get ranking position for an agent
   */
  async getAgentRankingPosition(agentId: string): Promise<number> {
    const agent = await this.prisma.agentRays.findUnique({
      where: { agentId },
    });

    if (!agent) return -1;

    const position = await this.prisma.agentRays.count({
      where: {
        totalRaysAccumulated: {
          gt: agent.totalRaysAccumulated,
        },
      },
    });

    return position + 1;
  }

  /**
   * Get all agents sorted by rays (for trending)
   */
  async getTrendingAgents(limit = 100) {
    const trending = await this.prisma.agentRays.findMany({
      include: {
        agent: {
          select: {
            id: true,
            name: true,
            status: true,
            user: {
              select: {
                username: true,
              },
            },
          },
        },
      },
      orderBy: {
        totalRaysAccumulated: 'desc',
      },
      take: limit,
    });

    return trending.map((item, index) => ({
      position: index + 1,
      agentId: item.agent.id,
      agentName: item.agent.name,
      creator: item.agent.user?.username || 'Unknown',
      totalRays: item.totalRaysAccumulated,
      rank: item.currentRank,
      status: item.agent.status,
    }));
  }
}
