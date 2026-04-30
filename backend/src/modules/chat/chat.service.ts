import { Injectable, Logger, ForbiddenException, NotFoundException } from '@nestjs/common';

import { PrismaService } from '../../common/prisma/prisma.service';
import { RedisService } from '../../common/redis/redis.service';
import { sanitizeText } from '../../common/sanitize/sanitize.util';

const MAX_MESSAGE_LENGTH = 500;
const FLOOD_WINDOW = 10; // seconds
const FLOOD_MAX = 5; // messages per window
const SPAM_PATTERNS = [
  /(.)\1{9,}/, // 10+ repeated chars
  /https?:\/\//gi, // URLs (configurable)
];

/** Allowed channels. Keep this flat — no per-channel permissions yet. */
export const FEED_CHANNELS = ['general', 'marketplace', 'agents', 'dev', 'random'] as const;
export type FeedChannel = (typeof FEED_CHANNELS)[number];

export function normalizeChannel(raw: unknown): FeedChannel {
  const s = typeof raw === 'string' ? raw.toLowerCase().trim() : '';
  return (FEED_CHANNELS as readonly string[]).includes(s) ? (s as FeedChannel) : 'general';
}

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async validateAndSave(
    userId: string,
    content: string,
    options: { channel?: string; imageUrl?: string | null; viaAgentListingId?: string | null } = {},
  ) {
    // ── Input validation ──────────────────────────────────────────────────
    if (!content || typeof content !== 'string') {
      throw new ForbiddenException('Invalid message');
    }

    const trimmed = content.trim();
    if (trimmed.length === 0 || trimmed.length > MAX_MESSAGE_LENGTH) {
      throw new ForbiddenException(`Message must be 1-${MAX_MESSAGE_LENGTH} characters`);
    }

    const channel = normalizeChannel(options.channel);
    const imageUrl = typeof options.imageUrl === 'string' ? options.imageUrl.slice(0, 500) : null;

    // If the user claims to post "via" an agent listing, verify they own
    // it and store the agent's title for the UI chip.
    let viaAgentListingId: string | null = null;
    let viaAgentName: string | null = null;
    if (options.viaAgentListingId) {
      const listing = await this.prisma.marketListing.findFirst({
        where: {
          id: options.viaAgentListingId,
          sellerId: userId,
          type: 'AI_AGENT',
        },
        select: { id: true, title: true },
      });
      if (!listing) {
        throw new ForbiddenException('That agent listing is not yours or not an AI agent');
      }
      viaAgentListingId = listing.id;
      viaAgentName = listing.title.slice(0, 80);
    }

    // ── Flood control ─────────────────────────────────────────────────────
    const floodKey = `chat_flood:${userId}`;
    const count = await this.redis.incr(floodKey);
    if (count === 1) {
      await this.redis.expire(floodKey, FLOOD_WINDOW);
    }
    if (count > FLOOD_MAX) {
      const ttl = await this.redis.ttl(floodKey);
      throw new ForbiddenException(`Rate limited. Try again in ${ttl}s`);
    }

    // ── Spam detection ────────────────────────────────────────────────────
    for (const pattern of SPAM_PATTERNS) {
      if (pattern.test(trimmed)) {
        throw new ForbiddenException('Message contains disallowed content');
      }
    }

    // ── Check user status ─────────────────────────────────────────────────
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { isBanned: true, username: true, avatarUrl: true },
    });

    if (!user || user.isBanned) {
      throw new ForbiddenException('Account is restricted');
    }

    // ── Sanitize and store ────────────────────────────────────────────────
    const sanitized = sanitizeText(trimmed);

    const message = await this.prisma.chatMessage.create({
      data: {
        content: sanitized,
        userId,
        channel,
        imageUrl,
        viaAgentListingId,
        viaAgentName,
      },
      include: {
        user: {
          select: { username: true, avatarUrl: true, reputationPoints: true },
        },
      },
    });

    return message;
  }

  async getRecentMessages(limit = 50, cursor?: string, channel?: string) {
    const where: { isDeleted: boolean; channel?: string } = { isDeleted: false };
    if (channel) where.channel = normalizeChannel(channel);
    const messages = await this.prisma.chatMessage.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: Math.min(limit, 100),
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: {
        user: {
          select: { username: true, avatarUrl: true, id: true, reputationPoints: true },
        },
      },
    });
    return messages.reverse();
  }

  /**
   * Toggle a like. Returns the new liked state + updated count so the
   * client can reconcile without re-fetching the whole post.
   */
  async toggleLike(
    messageId: string,
    userId: string,
  ): Promise<{ liked: boolean; likeCount: number }> {
    const existing = await this.prisma.chatMessageLike.findUnique({
      where: { messageId_userId: { messageId, userId } },
    });

    if (existing) {
      const updated = await this.prisma.$transaction(async (tx) => {
        await tx.chatMessageLike.delete({ where: { id: existing.id } });
        return tx.chatMessage.update({
          where: { id: messageId },
          data: { likeCount: { decrement: 1 } },
          select: { likeCount: true },
        });
      });
      return { liked: false, likeCount: Math.max(0, updated.likeCount) };
    }

    const message = await this.prisma.chatMessage.findUnique({
      where: { id: messageId },
      select: { id: true, isDeleted: true },
    });
    if (!message || message.isDeleted) throw new NotFoundException('Message not found');

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.chatMessageLike.create({ data: { messageId, userId } });
      return tx.chatMessage.update({
        where: { id: messageId },
        data: { likeCount: { increment: 1 } },
        select: { likeCount: true },
      });
    });
    return { liked: true, likeCount: updated.likeCount };
  }

  /** Which of these messages the given user has liked (for timeline state). */
  async likedMessageIds(messageIds: string[], userId: string): Promise<Set<string>> {
    if (messageIds.length === 0 || !userId) return new Set();
    const rows = await this.prisma.chatMessageLike.findMany({
      where: { userId, messageId: { in: messageIds } },
      select: { messageId: true },
    });
    return new Set(rows.map((r) => r.messageId));
  }

  async deleteMessage(messageId: string, moderatorId: string, reason?: string) {
    const moderator = await this.prisma.user.findUnique({
      where: { id: moderatorId },
      select: { role: true },
    });

    if (!moderator || !['ADMIN', 'MODERATOR'].includes(moderator.role)) {
      throw new ForbiddenException('Insufficient permissions');
    }

    await this.prisma.chatMessage.update({
      where: { id: messageId },
      data: {
        isDeleted: true,
        deletedAt: new Date(),
        deleteReason: reason,
      },
    });

    this.logger.log(`Message ${messageId} deleted by moderator ${moderatorId}`);
  }

  async reportMessage(messageId: string, reporterId: string, reason: string) {
    if (!reason || reason.trim().length < 5) {
      throw new ForbiddenException('Report reason is required (min 5 chars)');
    }

    const message = await this.prisma.chatMessage.findUnique({
      where: { id: messageId },
    });

    if (!message) throw new NotFoundException('Message not found');

    // Prevent duplicate reports
    const existing = await this.prisma.report.findFirst({
      where: { messageId, reporterId },
    });

    if (existing) {
      throw new ForbiddenException('You have already reported this message');
    }

    return this.prisma.report.create({
      data: {
        messageId,
        reporterId,
        reason: sanitizeText(reason.trim().slice(0, 500)),
      },
    });
  }
}
