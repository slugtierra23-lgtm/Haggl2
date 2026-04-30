import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import axios from 'axios';

import { PrismaService } from '../../common/prisma/prisma.service';
import { isSafeUrlResolving } from '../../common/sanitize/sanitize.util';
import { EmailService } from '../email/email.service';
import { NotificationsService } from '../notifications/notifications.service';

/**
 * Periodic ping over every ACTIVE AI_AGENT marketplace listing. If an
 * agent's webhook stops responding for 2 consecutive cycles we flip
 * the listing to REMOVED and email the seller. When the endpoint comes
 * back we auto-reactivate + email the recovery so the seller never has
 * to manually re-publish.
 */
@Injectable()
export class AgentHealthService {
  private readonly logger = new Logger(AgentHealthService.name);

  // In-memory failure counter. Survives within a single process; a
  // flap across restarts is fine — Prisma's `status` column is the
  // source of truth the cron reconciles against every pass.
  private readonly consecutiveFailures = new Map<string, number>();

  // Mark a listing inactive after this many consecutive failed pings.
  // 2 × 10-minute cycles = ~20 minutes of downtime before we flip.
  private readonly FAILS_TO_DEACTIVATE = 2;
  private readonly PING_TIMEOUT_MS = 6000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly emails: EmailService,
    private readonly notifications: NotificationsService,
  ) {}

  @Cron(CronExpression.EVERY_10_MINUTES)
  async runHealthCheck(): Promise<void> {
    if (process.env.AGENT_HEALTH_DISABLED === '1') return;

    // Pull both ACTIVE and REMOVED so we can auto-recover sellers who
    // fixed their endpoint without having to manually re-publish.
    const listings = await this.prisma.marketListing.findMany({
      where: {
        type: 'AI_AGENT',
        status: { in: ['ACTIVE', 'REMOVED'] },
        agentEndpoint: { not: null },
      },
      select: {
        id: true,
        title: true,
        status: true,
        agentEndpoint: true,
        sellerId: true,
        seller: { select: { email: true, username: true } },
      },
      take: 200,
    });

    if (listings.length === 0) return;
    this.logger.debug(`Health-check sweep over ${listings.length} AI_AGENT listings`);

    // Fire all pings in parallel — upstream timeouts already cap each
    // call so a bad agent can't stall the batch.
    await Promise.allSettled(
      listings.map((l) =>
        this.checkOne({
          listingId: l.id,
          listingTitle: l.title,
          status: l.status,
          endpoint: l.agentEndpoint!,
          sellerId: l.sellerId,
          sellerEmail: l.seller?.email ?? null,
        }),
      ),
    );
  }

  private async checkOne(params: {
    listingId: string;
    listingTitle: string;
    status: string;
    endpoint: string;
    sellerId: string;
    sellerEmail: string | null;
  }): Promise<void> {
    const ok = await this.ping(params.endpoint);
    if (ok) {
      this.consecutiveFailures.delete(params.listingId);
      // Recovery path: if we had flipped it to REMOVED for health
      // reasons, bring it back and tell the seller.
      if (params.status === 'REMOVED') {
        await this.prisma.marketListing
          .update({
            where: { id: params.listingId },
            data: { status: 'ACTIVE' },
          })
          .catch(() => void 0);
        await this.notifyRecovery(params);
      }
      return;
    }

    const prev = this.consecutiveFailures.get(params.listingId) ?? 0;
    const next = prev + 1;
    this.consecutiveFailures.set(params.listingId, next);

    if (next >= this.FAILS_TO_DEACTIVATE && params.status === 'ACTIVE') {
      await this.prisma.marketListing
        .update({
          where: { id: params.listingId },
          data: { status: 'REMOVED' },
        })
        .catch(() => void 0);
      await this.notifyOutage(params);
      // Reset so we don't re-email on every subsequent tick.
      this.consecutiveFailures.set(params.listingId, 0);
    }
  }

  /**
   * One-shot health check against a single listing. Used by the on-
   * demand HTTP endpoint so the UI can gate the "AI-launch" option on
   * a fresh probe instead of waiting for the 10min cron.
   */
  async checkListing(listingId: string): Promise<{
    healthy: boolean;
    latencyMs: number;
    reason?: string;
  }> {
    const listing = await this.prisma.marketListing.findUnique({
      where: { id: listingId },
      select: { type: true, agentEndpoint: true, status: true },
    });
    if (!listing) return { healthy: false, latencyMs: 0, reason: 'not_found' };
    if (listing.type !== 'AI_AGENT') {
      return { healthy: false, latencyMs: 0, reason: 'not_an_agent' };
    }
    if (!listing.agentEndpoint) {
      return { healthy: false, latencyMs: 0, reason: 'no_endpoint' };
    }
    const start = Date.now();
    const ok = await this.ping(listing.agentEndpoint);
    return {
      healthy: ok,
      latencyMs: Date.now() - start,
      reason: ok ? undefined : 'unreachable',
    };
  }

  private async ping(endpoint: string): Promise<boolean> {
    try {
      const safe = await isSafeUrlResolving(endpoint);
      if (!safe.ok) return false;
      const res = await axios.post(
        endpoint,
        { event: 'health_check' },
        {
          timeout: this.PING_TIMEOUT_MS,
          maxRedirects: 0,
          headers: { 'Content-Type': 'application/json', 'X-Haggl-Event': 'health_check' },
          maxBodyLength: 4096,
          maxContentLength: 4096,
          validateStatus: (s) => s >= 200 && s < 500,
        },
      );
      // Treat any 2xx/3xx as healthy; 4xx means the agent answered but
      // refused our payload, which is still "alive". 5xx / timeout /
      // network error count as down.
      return res.status < 500;
    } catch {
      return false;
    }
  }

  private async notifyOutage(params: {
    listingId: string;
    listingTitle: string;
    sellerId: string;
    sellerEmail: string | null;
  }): Promise<void> {
    await this.notifications
      .create({
        userId: params.sellerId,
        type: 'SYSTEM',
        title: 'Your agent is offline',
        body: `${params.listingTitle} stopped responding and has been paused — it won't appear in the marketplace until its webhook is back.`,
        url: `/market/agents/${params.listingId}`,
        meta: { kind: 'agent_offline', listingId: params.listingId },
      })
      .catch(() => void 0);

    if (params.sellerEmail) {
      await this.emails
        .sendAgentHealthAlert(params.sellerEmail, {
          listingTitle: params.listingTitle,
          listingId: params.listingId,
          kind: 'offline',
        })
        .catch(() => void 0);
    }
  }

  private async notifyRecovery(params: {
    listingId: string;
    listingTitle: string;
    sellerId: string;
    sellerEmail: string | null;
  }): Promise<void> {
    await this.notifications
      .create({
        userId: params.sellerId,
        type: 'SYSTEM',
        title: 'Your agent is back online',
        body: `${params.listingTitle} is responding again and is live on the marketplace.`,
        url: `/market/agents/${params.listingId}`,
        meta: { kind: 'agent_recovered', listingId: params.listingId },
      })
      .catch(() => void 0);

    if (params.sellerEmail) {
      await this.emails
        .sendAgentHealthAlert(params.sellerEmail, {
          listingTitle: params.listingTitle,
          listingId: params.listingId,
          kind: 'recovered',
        })
        .catch(() => void 0);
    }
  }
}
