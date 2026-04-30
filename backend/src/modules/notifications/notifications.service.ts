import { Injectable, NotFoundException } from '@nestjs/common';
import { NotificationType, Prisma } from '@prisma/client';

import { PrismaService } from '../../common/prisma/prisma.service';
import { RedisService } from '../../common/redis/redis.service';

import { NotificationsGateway } from './notifications.gateway';

export interface CreateNotificationInput {
  userId: string;
  type: NotificationType;
  title: string;
  body?: string | null;
  url?: string | null;
  meta?: Prisma.InputJsonValue | null;
}

// 30s cache on the unread badge — it's hit on every page nav from
// the navbar. Without caching the prisma.count was costing ~1.3s per
// request even with the (userId, readAt) index. Invalidated on
// create / markRead / markAllRead.
const UNREAD_CACHE_TTL = 30;
const unreadKey = (userId: string) => `notif:unread:${userId}`;

@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: NotificationsGateway,
    private readonly redis: RedisService,
  ) {}

  async create(input: CreateNotificationInput) {
    const notification = await this.prisma.notification.create({
      data: {
        userId: input.userId,
        type: input.type,
        title: input.title.slice(0, 200),
        body: input.body ? input.body.slice(0, 2000) : null,
        url: input.url || null,
        meta: input.meta ?? Prisma.JsonNull,
      },
    });
    await this.redis.del(unreadKey(input.userId)).catch(() => void 0);
    this.gateway.pushToUser(input.userId, notification);
    return notification;
  }

  async list(userId: string, params: { unreadOnly?: boolean; take?: number } = {}) {
    const take = Math.min(100, Math.max(1, params.take ?? 30));
    const where: Prisma.NotificationWhereInput = { userId };
    if (params.unreadOnly) where.readAt = null;
    const [items, unreadCount] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take,
      }),
      this.prisma.notification.count({ where: { userId, readAt: null } }),
    ]);
    // Refresh the cache from this read since we just paid for the count.
    await this.redis
      .set(unreadKey(userId), String(unreadCount), UNREAD_CACHE_TTL)
      .catch(() => void 0);
    return { items, unreadCount };
  }

  async unreadCount(userId: string): Promise<number> {
    const cached = await this.redis.get(unreadKey(userId)).catch(() => null);
    if (cached !== null) {
      const n = Number(cached);
      if (Number.isFinite(n) && n >= 0) return n;
    }
    const count = await this.prisma.notification.count({
      where: { userId, readAt: null },
    });
    await this.redis.set(unreadKey(userId), String(count), UNREAD_CACHE_TTL).catch(() => void 0);
    return count;
  }

  async markRead(id: string, userId: string) {
    const n = await this.prisma.notification.findUnique({ where: { id } });
    if (!n || n.userId !== userId) throw new NotFoundException();
    const updated = await this.prisma.notification.update({
      where: { id },
      data: { readAt: new Date() },
    });
    await this.redis.del(unreadKey(userId)).catch(() => void 0);
    this.gateway.pushReadToUser(userId, id);
    return updated;
  }

  async markAllRead(userId: string) {
    await this.prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
    await this.redis.del(unreadKey(userId)).catch(() => void 0);
    this.gateway.pushReadAllToUser(userId);
    return { ok: true };
  }
}
