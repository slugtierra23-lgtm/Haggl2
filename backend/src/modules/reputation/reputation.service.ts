import { Injectable, Logger } from '@nestjs/common';
import { ReputationReason } from '@prisma/client';

import { PrismaService } from '../../common/prisma/prisma.service';

export enum ReputationRank {
  NEWCOMER = 'NEWCOMER',
  BRONZE = 'BRONZE',
  SILVER = 'SILVER',
  GOLD = 'GOLD',
  PLATINUM = 'PLATINUM',
  DIAMOND = 'DIAMOND',
  LEGEND = 'LEGEND',
}

export const RANK_THRESHOLDS: Record<ReputationRank, number> = {
  [ReputationRank.NEWCOMER]: 0,
  [ReputationRank.BRONZE]: 50,
  [ReputationRank.SILVER]: 200,
  [ReputationRank.GOLD]: 600,
  [ReputationRank.PLATINUM]: 1500,
  [ReputationRank.DIAMOND]: 4000,
  [ReputationRank.LEGEND]: 10000,
};

export const RANK_POINTS: Record<string, number> = {
  REPO_PUBLISHED: 15,
  REPO_SOLD: 75,
  REPO_PURCHASED: 10,
  REPO_UPVOTE_RECEIVED: 5,
  LISTING_PUBLISHED: 20,
  AI_AGENT_PUBLISHED: 30,
  LISTING_SOLD: 100,
  LISTING_PURCHASED: 10,
  PROFILE_COMPLETED: 10,
  SERVICE_COMPLETED: 50,
  FIRST_SALE: 150,
  FIRST_PURCHASE: 50,
  COLLABORATOR_ADDED: 10,
};

export function getRankForPoints(points: number): ReputationRank {
  if (points >= RANK_THRESHOLDS[ReputationRank.LEGEND]) return ReputationRank.LEGEND;
  if (points >= RANK_THRESHOLDS[ReputationRank.DIAMOND]) return ReputationRank.DIAMOND;
  if (points >= RANK_THRESHOLDS[ReputationRank.PLATINUM]) return ReputationRank.PLATINUM;
  if (points >= RANK_THRESHOLDS[ReputationRank.GOLD]) return ReputationRank.GOLD;
  if (points >= RANK_THRESHOLDS[ReputationRank.SILVER]) return ReputationRank.SILVER;
  if (points >= RANK_THRESHOLDS[ReputationRank.BRONZE]) return ReputationRank.BRONZE;
  return ReputationRank.NEWCOMER;
}

export const RANK_META: Record<
  ReputationRank,
  { label: string; color: string; badge: string; description: string }
> = {
  [ReputationRank.NEWCOMER]: {
    label: 'Newcomer',
    color: '#71717a',
    badge: '◎',
    description: 'Just getting started on the platform',
  },
  [ReputationRank.BRONZE]: {
    label: 'Bronze',
    color: '#cd7f32',
    badge: '🥉',
    description: 'Actively contributing to the community',
  },
  [ReputationRank.SILVER]: {
    label: 'Silver',
    color: '#9ca3af',
    badge: '🥈',
    description: 'Established developer with proven contributions',
  },
  [ReputationRank.GOLD]: {
    label: 'Gold',
    color: '#f59e0b',
    badge: '🥇',
    description: 'Highly respected community member',
  },
  [ReputationRank.PLATINUM]: {
    label: 'Platinum',
    color: '#a855f7',
    badge: '💎',
    description: 'Elite developer with exceptional track record',
  },
  [ReputationRank.DIAMOND]: {
    label: 'Diamond',
    color: '#38bdf8',
    badge: '💠',
    description: 'Top-tier contributor trusted by thousands',
  },
  [ReputationRank.LEGEND]: {
    label: 'Legend',
    color: '#836ef9',
    badge: '⚡',
    description: 'Hall of fame — the pinnacle of the haggl ecosystem',
  },
};

@Injectable()
export class ReputationService {
  private readonly logger = new Logger(ReputationService.name);

  constructor(private readonly prisma: PrismaService) {}

  async awardPoints(
    userId: string,
    reason: string,
    resourceId?: string,
    note?: string,
  ): Promise<void> {
    const points = RANK_POINTS[reason];
    if (!points) {
      this.logger.warn(`Unknown reputation reason: ${reason}`);
      return;
    }

    await this.prisma.$transaction([
      this.prisma.reputationEvent.create({
        data: {
          userId,
          points,
          reason: reason as ReputationReason,
          resourceId: resourceId || null,
          note: note || null,
        },
      }),
      this.prisma.user.update({
        where: { id: userId },
        data: { reputationPoints: { increment: points } },
      }),
    ]);

    this.logger.log(`Awarded ${points} reputation points to user ${userId} for ${reason}`);
  }

  async getUserReputation(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { reputationPoints: true },
    });

    const points = user?.reputationPoints ?? 0;
    const rank = getRankForPoints(points);
    const meta = RANK_META[rank];

    // Calculate progress to next rank
    const ranks = Object.values(ReputationRank);
    const currentIdx = ranks.indexOf(rank);
    const nextRank = ranks[currentIdx + 1] as ReputationRank | undefined;
    const nextThreshold = nextRank ? RANK_THRESHOLDS[nextRank] : null;
    const currentThreshold = RANK_THRESHOLDS[rank];
    const progress = nextThreshold
      ? Math.min(
          100,
          Math.floor(((points - currentThreshold) / (nextThreshold - currentThreshold)) * 100),
        )
      : 100;

    const events = await this.prisma.reputationEvent.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    return {
      points,
      rank,
      rankMeta: meta,
      nextRank,
      nextRankMeta: nextRank ? RANK_META[nextRank] : null,
      nextThreshold,
      progress,
      recentEvents: events,
    };
  }

  async getLeaderboard(limit = 20) {
    const users = await this.prisma.user.findMany({
      where: {
        reputationPoints: { gt: 0 },
        isBanned: false,
      },
      orderBy: { reputationPoints: 'desc' },
      take: limit,
      select: {
        id: true,
        username: true,
        displayName: true,
        avatarUrl: true,
        reputationPoints: true,
        occupation: true,
        _count: { select: { repositories: true, marketListings: true } },
      },
    });

    return users.map((u, idx) => ({
      ...u,
      position: idx + 1,
      rank: getRankForPoints(u.reputationPoints),
      rankMeta: RANK_META[getRankForPoints(u.reputationPoints)],
    }));
  }
}
