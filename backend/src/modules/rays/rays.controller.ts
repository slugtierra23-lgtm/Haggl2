import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import { RaysPack } from '@prisma/client';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

import { RaysService } from './rays.service';

@Controller('rays')
@UseGuards(JwtAuthGuard)
export class RaysController {
  constructor(private readonly raysService: RaysService) {}

  /**
   * Get available packs
   * GET /rays/packs
   */
  @Get('packs')
  getPacks() {
    const packs = this.raysService.getPacks();
    return {
      success: true,
      packs: packs.map((p) => ({
        pack: p.pack,
        rays: p.rays,
         hagglPrice: p.hagglPrice,
      })),
    };
  }

  /**
   * Purchase rays for an agent with on-chain payment verification
   * POST /rays/purchase
   *
   * SECURITY: Requires blockchain transaction verification
   * - txHash: Ethereum transaction hash confirming payment
   * - amountWei: Amount paid (must match pack price exactly)
   */
  @Post('purchase')
  @HttpCode(HttpStatus.CREATED)
  async purchaseRays(
    @CurrentUser() user: any,
    @Body() body: { agentId: string; pack: RaysPack; txHash: string; amountWei: string },
  ) {
    if (!body.txHash || !body.amountWei) {
      throw new BadRequestException(
        'txHash and amountWei are required for Rays purchase verification',
      );
    }

    const purchase = await this.raysService.purchaseRays(
      user.sub,
      body.agentId,
      body.pack,
      body.txHash,
      body.amountWei,
    );

    // Get updated agent rays info
    const agentRays = await this.raysService.getAgentRays(body.agentId);

    return {
      success: true,
      purchase: {
        id: purchase.id,
        raysPack: purchase.raysPack,
        raysAmount: purchase.raysAmount,
         hagglAmount: purchase.hagglAmount,
        txHash: purchase.txHash,
      },
      agentRays: {
        totalRaysAccumulated: agentRays.totalRaysAccumulated,
        currentRank: agentRays.currentRank,
      },
    };
  }

  /**
   * Get agent rays info
   * GET /rays/agent/:agentId
   */
  @Get('agent/:agentId')
  async getAgentRays(@Param('agentId') agentId: string) {
    const agentRays = await this.raysService.getAgentRays(agentId);
    const position = await this.raysService.getAgentRankingPosition(agentId);

    return {
      success: true,
      agentRays: {
        agentId: agentRays.agentId,
        totalRaysAccumulated: agentRays.totalRaysAccumulated,
        currentRank: agentRays.currentRank,
        lastRankUpAt: agentRays.lastRankUpAt,
        position,
      },
      recentRankChanges: agentRays.rankHistory.slice(0, 5),
    };
  }

  /**
   * Get rays leaderboard
   * GET /rays/leaderboard
   */
  @Get('leaderboard/rays')
  async getRaysLeaderboard() {
    const leaderboard = await this.raysService.getRaysLeaderboard();

    return {
      success: true,
      leaderboard,
      totalAgents: leaderboard.length,
    };
  }

  /**
   * Get creators leaderboard
   * GET /rays/leaderboard/creators
   */
  @Get('leaderboard/creators')
  async getCreatorsLeaderboard() {
    const leaderboard = await this.raysService.getCreatorsLeaderboard();

    return {
      success: true,
      leaderboard,
      totalCreators: leaderboard.length,
    };
  }

  /**
   * Get trending agents
   * GET /rays/trending
   */
  @Get('trending')
  async getTrendingAgents() {
    const trending = await this.raysService.getTrendingAgents();

    return {
      success: true,
      agents: trending,
      totalAgents: trending.length,
    };
  }

  /**
   * Get agent ranking position
   * GET /rays/position/:agentId
   */
  @Get('position/:agentId')
  async getAgentPosition(@Param('agentId') agentId: string) {
    const position = await this.raysService.getAgentRankingPosition(agentId);

    return {
      success: true,
      agentId,
      position,
    };
  }
}
