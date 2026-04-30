import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import axios from 'axios';

import { PrismaService } from '../../common/prisma/prisma.service';
import { signRequest } from '../agents/agents-hmac.util';

import { AgentXService } from './agent-x.service';

/**
 * Phase 2 — autonomous tweeting + reply-to-mentions.
 *
 * Once a seller flips `autonomousEnabled` on their AgentXConnection,
 * the cron in this service polls every hour and, for each listing
 * whose `lastAutonomousAt + postIntervalHours` is in the past, asks
 * the listing's agent webhook *whether* it wants to tweet about its
 * token right now.
 *
 * The agent contract is intentionally narrow:
 *
 *   POST <listing.agentEndpoint>
 *   X-Bolty-Event: x_decide_post
 *   X-Bolty-Signature: t=…,v1=…
 *   { tokenAddress?, symbol?, name?, screenName, lastPostedAt? }
 *
 *   → { shouldTweet: boolean, text?: string, reason?: string }
 *
 * If the agent says yes, the proposal lands in `agent_x_scheduled_posts`
 * either as PENDING_APPROVAL (when the listing keeps the human gate
 * on) or as POSTED immediately (gate off → cron tweets right away
 * via {@link AgentXService.postScheduledPost}).
 *
 * Mentions follow the same shape, with `X-Bolty-Event: x_decide_mention`
 * and an `inReplyTo` payload. Each mention is queued as a separate row
 * with `triggerType = MENTION_REPLY` so the queue UI is uniform.
 *
 * Why a separate service instead of folding into AgentXService:
 *  - keeps the per-listing cron isolated from the synchronous
 *    publish-launch tweet path so a runaway agent webhook can't
 *    block on-chain confirmations
 *  - lets us iterate on autonomous-only knobs (cap, interval, mention
 *    polling) without touching the launch tweet code
 */
@Injectable()
export class AgentXAutonomousService {
  private readonly logger = new Logger(AgentXAutonomousService.name);

  /** Wall-clock cap on a single agent webhook call. Conservative — the
   *  cron can run again next hour, we don't want it stuck on a slow
   *  agent endpoint blocking other listings in the same loop. */
  private static readonly WEBHOOK_TIMEOUT_MS = 8000;

  /** Hard ceiling on how many listings the cron processes per tick.
   *  Prevents a runaway DB scan if hundreds of agents have the toggle
   *  on. The next tick picks up the rest. */
  private static readonly MAX_PER_TICK = 50;

  /** How many mention pages to pull per listing per poll. X returns up
   *  to 100 per page; one page is plenty for a 5-min cadence. */
  private static readonly MENTIONS_MAX_RESULTS = 20;

  constructor(
    private readonly prisma: PrismaService,
    private readonly agentX: AgentXService,
  ) {}

  // ─── Public config / queue endpoints (called by controller) ────────

  /** Validate + persist the seller's autonomous prefs for a listing.
   *  Caller already proved ownership via the controller guard. */
  async updateConfig(
    listingId: string,
    patch: {
      autonomousEnabled?: boolean;
      postIntervalHours?: number;
      requireApproval?: boolean;
      mentionsEnabled?: boolean;
    },
  ): Promise<{ ok: true }> {
    if (
      patch.postIntervalHours !== undefined &&
      (patch.postIntervalHours < 1 || patch.postIntervalHours > 24 * 7)
    ) {
      throw new BadRequestException('postIntervalHours must be between 1 and 168');
    }
    const conn = await this.prisma.agentXConnection.findUnique({ where: { listingId } });
    if (!conn) throw new NotFoundException('No X connection for this listing — connect X first.');
    await this.prisma.agentXConnection.update({
      where: { listingId },
      data: {
        ...(patch.autonomousEnabled !== undefined && {
          autonomousEnabled: patch.autonomousEnabled,
        }),
        ...(patch.postIntervalHours !== undefined && {
          postIntervalHours: patch.postIntervalHours,
        }),
        ...(patch.requireApproval !== undefined && { requireApproval: patch.requireApproval }),
        ...(patch.mentionsEnabled !== undefined && { mentionsEnabled: patch.mentionsEnabled }),
      },
    });
    return { ok: true };
  }

  async getConfig(listingId: string) {
    const conn = await this.prisma.agentXConnection.findUnique({
      where: { listingId },
      select: {
        autonomousEnabled: true,
        postIntervalHours: true,
        requireApproval: true,
        mentionsEnabled: true,
        lastAutonomousAt: true,
        mentionsLastSyncedAt: true,
      },
    });
    if (!conn) throw new NotFoundException('No X connection for this listing');
    return conn;
  }

  async listQueue(
    listingId: string,
    status?: 'PENDING_APPROVAL' | 'POSTED' | 'FAILED' | 'REJECTED',
  ) {
    return this.prisma.agentXScheduledPost.findMany({
      where: { listingId, ...(status && { status }) },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  async approve(listingId: string, postId: string) {
    const post = await this.prisma.agentXScheduledPost.findUnique({ where: { id: postId } });
    if (!post || post.listingId !== listingId) throw new NotFoundException('Queued post not found');
    if (post.status !== 'PENDING_APPROVAL') {
      throw new BadRequestException(`Post is ${post.status}, can only approve PENDING_APPROVAL`);
    }
    return this.publish(post.id);
  }

  async reject(listingId: string, postId: string) {
    const post = await this.prisma.agentXScheduledPost.findUnique({ where: { id: postId } });
    if (!post || post.listingId !== listingId) throw new NotFoundException('Queued post not found');
    if (post.status !== 'PENDING_APPROVAL') {
      throw new BadRequestException(`Post is ${post.status}, can only reject PENDING_APPROVAL`);
    }
    await this.prisma.agentXScheduledPost.update({
      where: { id: postId },
      data: { status: 'REJECTED' },
    });
    return { ok: true };
  }

  /** Manual "decide now" — bypasses the cron and asks the agent
   *  immediately. Useful for the seller to test the webhook + see what
   *  the agent currently thinks without waiting up to N hours. */
  async decideNow(
    listingId: string,
  ): Promise<{ queued: boolean; postId?: string; reason?: string }> {
    const conn = await this.requireActiveConnection(listingId);
    const decision = await this.askAgentToTweet(conn);
    if (!decision.shouldTweet || !decision.text) {
      return { queued: false, reason: decision.reason || 'agent declined' };
    }
    const queued = await this.queueProposal(conn.listingId, {
      text: decision.text,
      reason: decision.reason ?? null,
      context: decision.context ?? null,
      triggerType: 'MANUAL',
    });
    if (!conn.requireApproval) await this.publish(queued.id);
    return { queued: true, postId: queued.id };
  }

  // ─── Cron: autonomous post pulse ───────────────────────────────────

  /** Hourly tick. For each listing that's due, asks the agent and
   *  queues / publishes the result. Each listing's failure is isolated
   *  so one broken webhook doesn't take down the loop. */
  @Cron(CronExpression.EVERY_HOUR)
  async runAutonomousPulse(): Promise<void> {
    const now = new Date();
    const due = await this.prisma.agentXConnection.findMany({
      where: {
        autonomousEnabled: true,
        // Filter out connections without OAuth 1.0a credentials —
        // there's no point asking the agent to tweet if we can't
        // post the result. (OAuth 2.0 path also fails 402 on Free.)
        oauth1AccessTokenEnc: { not: null },
      },
      take: AgentXAutonomousService.MAX_PER_TICK,
    });
    for (const conn of due) {
      const intervalMs = conn.postIntervalHours * 60 * 60 * 1000;
      const lastAt = conn.lastAutonomousAt?.getTime() ?? 0;
      if (lastAt + intervalMs > now.getTime()) continue;

      try {
        const decision = await this.askAgentToTweet(conn);
        await this.prisma.agentXConnection.update({
          where: { listingId: conn.listingId },
          data: { lastAutonomousAt: now },
        });
        if (!decision.shouldTweet || !decision.text) continue;

        const queued = await this.queueProposal(conn.listingId, {
          text: decision.text,
          reason: decision.reason ?? null,
          context: decision.context ?? null,
          triggerType: 'SCHEDULED',
        });
        if (!conn.requireApproval) {
          await this.publish(queued.id);
        }
      } catch (err) {
        this.logger.warn(
          `autonomous pulse failed for listing=${conn.listingId}: ${(err as Error).message}`,
        );
      }
    }
  }

  // ─── Cron: mention reply pulse ────────────────────────────────────

  /** Every 5 minutes: for each listing with mentions enabled, pull new
   *  mentions of the connected screen name from X and let the agent
   *  decide which (if any) to reply to. */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async runMentionsPulse(): Promise<void> {
    const due = await this.prisma.agentXConnection.findMany({
      where: {
        mentionsEnabled: true,
        oauth1AccessTokenEnc: { not: null },
        xUserId: { not: null },
      },
      take: AgentXAutonomousService.MAX_PER_TICK,
    });
    for (const conn of due) {
      try {
        await this.processMentionsForListing(conn.listingId);
      } catch (err) {
        this.logger.warn(
          `mentions pulse failed for listing=${conn.listingId}: ${(err as Error).message}`,
        );
      }
    }
  }

  private async processMentionsForListing(listingId: string): Promise<void> {
    const conn = await this.prisma.agentXConnection.findUnique({ where: { listingId } });
    if (!conn || !conn.xUserId) return;
    const creds = await this.agentX.loadOauth1CredsForListing(listingId);
    if (!creds) return;

    const url = `https://api.twitter.com/2/users/${conn.xUserId}/mentions`;
    const params: Record<string, string> = {
      max_results: String(AgentXAutonomousService.MENTIONS_MAX_RESULTS),
      'tweet.fields': 'author_id,created_at,text',
    };
    if (conn.lastMentionId) params.since_id = conn.lastMentionId;
    const fullUrl = `${url}?${new URLSearchParams(params).toString()}`;
    const authHeader = this.agentX.buildOauth1Header('GET', url, params, creds);

    let res;
    try {
      res = await axios.get<{
        data?: Array<{ id: string; text: string; author_id?: string; created_at?: string }>;
      }>(fullUrl, {
        headers: { Authorization: authHeader },
        timeout: AgentXAutonomousService.WEBHOOK_TIMEOUT_MS,
        validateStatus: () => true,
      });
    } catch (err) {
      throw new Error(`X mentions fetch failed: ${(err as Error).message}`);
    }
    if (res.status !== 200) {
      // 401/403 = creds bad. 429 = rate limited. Skip silently and
      // try again next tick.
      this.logger.warn(
        `mentions fetch http=${res.status} listing=${listingId}: ${JSON.stringify(res.data).slice(0, 200)}`,
      );
      return;
    }
    const mentions = res.data?.data ?? [];
    let highestId = conn.lastMentionId ?? '';
    for (const m of mentions) {
      if (m.id && (highestId === '' || m.id > highestId)) highestId = m.id;
      const decision = await this.askAgentToReplyMention(conn, m);
      if (!decision.shouldTweet || !decision.text) continue;
      const queued = await this.queueProposal(listingId, {
        text: decision.text,
        reason: decision.reason ?? null,
        context: { mention: m, agentReason: decision.reason ?? null },
        triggerType: 'MENTION_REPLY',
        inReplyToTweetId: m.id,
      });
      if (!conn.requireApproval) await this.publish(queued.id);
    }
    await this.prisma.agentXConnection.update({
      where: { listingId },
      data: {
        mentionsLastSyncedAt: new Date(),
        ...(highestId && highestId !== (conn.lastMentionId ?? '') && { lastMentionId: highestId }),
      },
    });
  }

  // ─── Webhook calls to the listing's agent endpoint ────────────────

  private async askAgentToTweet(conn: {
    listingId: string;
    screenName: string | null;
  }): Promise<{ shouldTweet: boolean; text?: string; reason?: string; context?: unknown }> {
    const listing = await this.prisma.marketListing.findUnique({
      where: { id: conn.listingId },
      select: { agentEndpoint: true, title: true, agentProtocol: true },
    });
    if (!listing?.agentEndpoint) {
      return { shouldTweet: false, reason: 'listing has no agent webhook configured' };
    }

    const body = {
      event: 'x_decide_post',
      listingId: conn.listingId,
      listingTitle: listing.title,
      screenName: conn.screenName,
    };
    return this.callAgentDecisionWebhook(listing.agentEndpoint, body);
  }

  private async askAgentToReplyMention(
    conn: { listingId: string; screenName: string | null },
    mention: { id: string; text: string; author_id?: string; created_at?: string },
  ): Promise<{ shouldTweet: boolean; text?: string; reason?: string; context?: unknown }> {
    const listing = await this.prisma.marketListing.findUnique({
      where: { id: conn.listingId },
      select: { agentEndpoint: true, title: true },
    });
    if (!listing?.agentEndpoint) {
      return { shouldTweet: false, reason: 'listing has no agent webhook configured' };
    }
    const body = {
      event: 'x_decide_mention',
      listingId: conn.listingId,
      listingTitle: listing.title,
      screenName: conn.screenName,
      mention: {
        id: mention.id,
        text: mention.text,
        authorId: mention.author_id,
        createdAt: mention.created_at,
      },
    };
    return this.callAgentDecisionWebhook(listing.agentEndpoint, body);
  }

  private async callAgentDecisionWebhook(
    endpoint: string,
    body: Record<string, unknown>,
  ): Promise<{ shouldTweet: boolean; text?: string; reason?: string; context?: unknown }> {
    const raw = JSON.stringify(body);
    const secret = process.env.AGENT_HMAC_SECRET || '';
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Bolty-Event': String(body.event),
    };
    if (secret) {
      const signed = signRequest(raw, secret);
      headers['X-Bolty-Signature'] = signed['x-bolty-signature'];
      headers['X-Bolty-Timestamp'] = signed['x-bolty-timestamp'];
    }

    let res;
    try {
      res = await axios.post<{ shouldTweet?: boolean; text?: string; reason?: string }>(
        endpoint,
        raw,
        {
          headers,
          timeout: AgentXAutonomousService.WEBHOOK_TIMEOUT_MS,
          validateStatus: () => true,
        },
      );
    } catch (err) {
      this.logger.warn(`agent webhook unreachable: ${(err as Error).message}`);
      return { shouldTweet: false, reason: 'agent webhook unreachable' };
    }
    if (res.status >= 400) {
      this.logger.warn(`agent webhook http=${res.status}`);
      return { shouldTweet: false, reason: `agent webhook returned ${res.status}` };
    }
    const data = res.data ?? {};
    const text = (data.text ?? '').trim();
    return {
      shouldTweet: !!data.shouldTweet && text.length > 0 && text.length <= 280,
      text: text.slice(0, 280),
      reason: data.reason,
    };
  }

  // ─── Queue + publish helpers ──────────────────────────────────────

  private async queueProposal(
    listingId: string,
    proposal: {
      text: string;
      reason: string | null;
      context: unknown;
      triggerType: 'SCHEDULED' | 'MENTION_REPLY' | 'MANUAL';
      inReplyToTweetId?: string;
    },
  ) {
    return this.prisma.agentXScheduledPost.create({
      data: {
        listingId,
        text: proposal.text,
        reason: proposal.reason,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        context: proposal.context as any,
        triggerType: proposal.triggerType,
        inReplyToTweetId: proposal.inReplyToTweetId ?? null,
        status: 'PENDING_APPROVAL',
      },
    });
  }

  /** Post a queued proposal to X, mark POSTED on success / FAILED on
   *  any X-side error. Used by the cron (when requireApproval=false)
   *  and by the explicit Approve endpoint. */
  private async publish(postId: string) {
    const post = await this.prisma.agentXScheduledPost.findUnique({ where: { id: postId } });
    if (!post) throw new NotFoundException('Queued post not found');
    if (post.status === 'POSTED') return { ok: true, tweetId: post.tweetId };

    try {
      const result = await this.agentX.postTweetForListing(post.listingId, post.text, {
        inReplyToTweetId: post.inReplyToTweetId ?? undefined,
      });
      const updated = await this.prisma.agentXScheduledPost.update({
        where: { id: postId },
        data: { status: 'POSTED', tweetId: result.id, postedAt: new Date(), failureReason: null },
      });
      return { ok: true, tweetId: updated.tweetId };
    } catch (err) {
      const status = err instanceof HttpException ? err.getStatus() : 0;
      const msg = (err as Error)?.message ?? 'failed';
      await this.prisma.agentXScheduledPost.update({
        where: { id: postId },
        data: { status: 'FAILED', failureReason: msg },
      });
      if (status === 402) {
        throw new HttpException(`X requires API credits to post: ${msg}`, 402);
      }
      throw new ForbiddenException(msg);
    }
  }

  private async requireActiveConnection(listingId: string) {
    const conn = await this.prisma.agentXConnection.findUnique({ where: { listingId } });
    if (!conn) throw new NotFoundException('No X connection for this listing');
    if (!conn.oauth1AccessTokenEnc) {
      throw new BadRequestException(
        'X account not connected with OAuth 1.0a — paste the 4 keys first.',
      );
    }
    return conn;
  }
}
