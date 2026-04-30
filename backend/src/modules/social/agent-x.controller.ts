import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Response } from 'express';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { SkipCsrf } from '../../common/guards/csrf.guard';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

import { AgentXAutonomousService } from './agent-x-autonomous.service';
import { AgentXService } from './agent-x.service';

/**
 * Per-listing X (Twitter) BYO endpoints.
 *
 *   POST   /social/agent-x/:listingId/setup        → store/rotate clientId+secret
 *   GET    /social/agent-x/:listingId/connect-url  → start OAuth (auth)
 *   GET    /social/agent-x/callback                → OAuth target (Public)
 *   GET    /social/agent-x/:listingId/status       → "configured? connected as @x"
 *   DELETE /social/agent-x/:listingId              → wipe the row
 */
@Controller('social/agent-x')
export class AgentXController {
  constructor(
    private readonly agentX: AgentXService,
    private readonly autonomous: AgentXAutonomousService,
  ) {}

  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post(':listingId/setup')
  async setup(
    @CurrentUser('id') userId: string,
    @Param('listingId') listingId: string,
    @Body() body: { clientId?: string; clientSecret?: string },
  ) {
    await this.agentX.assertOwner(listingId, userId);
    return this.agentX.upsertAppCredentials(
      listingId,
      body?.clientId ?? '',
      body?.clientSecret ?? '',
    );
  }

  /** Simpler "paste 4 keys" auth path. Verifies the keys against
   *  /2/users/me, captures the screen name on success, no OAuth dance.
   *  This is the path that works on X Free tier. */
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post(':listingId/setup-oauth1')
  async setupOauth1(
    @CurrentUser('id') userId: string,
    @Param('listingId') listingId: string,
    @Body()
    body: {
      consumerKey?: string;
      consumerSecret?: string;
      accessToken?: string;
      accessTokenSecret?: string;
    },
  ) {
    await this.agentX.assertOwner(listingId, userId);
    return this.agentX.saveOauth1Credentials(listingId, {
      consumerKey: (body?.consumerKey ?? '').trim(),
      consumerSecret: (body?.consumerSecret ?? '').trim(),
      accessToken: (body?.accessToken ?? '').trim(),
      accessTokenSecret: (body?.accessTokenSecret ?? '').trim(),
    });
  }

  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Get(':listingId/connect-url')
  async connectUrl(
    @CurrentUser('id') userId: string,
    @Param('listingId') listingId: string,
    @Query('returnTo') returnTo?: string,
    @Query('forceLogin') forceLogin?: string,
  ) {
    await this.agentX.assertOwner(listingId, userId);
    const force = forceLogin === '1' || forceLogin === 'true';
    return this.agentX.generateAuthUrl(listingId, userId, returnTo, { forceLogin: force });
  }

  /** OAuth landing — X is the caller, no JWT cookie. The state param
   *  carries listingId + verifier so we know which row to fill. */
  @Public()
  @SkipCsrf()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Get('callback')
  async callback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Query('error') error: string | undefined,
    @Res() res: Response,
  ) {
    const fe = process.env.FRONTEND_URL || 'https://www.boltynetwork.xyz';
    if (error) {
      return res.redirect(302, `${fe}/profile?agent_x_error=${encodeURIComponent(error)}`);
    }
    try {
      const { listingId, screenName, returnTo } = await this.agentX.handleCallback(code, state);
      const dest = sanitizeReturnTo(returnTo, fe, listingId);
      const sep = dest.includes('?') ? '&' : '?';
      return res.redirect(
        302,
        `${dest}${sep}agent_x_connected=${encodeURIComponent(screenName)}&listingId=${listingId}`,
      );
    } catch (err) {
      const msg = (err as Error).message ?? 'oauth_failed';
      return res.redirect(302, `${fe}/profile?agent_x_error=${encodeURIComponent(msg)}`);
    }
  }

  @UseGuards(JwtAuthGuard)
  @Get(':listingId/status')
  async status(@CurrentUser('id') userId: string, @Param('listingId') listingId: string) {
    await this.agentX.assertOwner(listingId, userId);
    return this.agentX.getStatus(listingId);
  }

  /** Profile-page roll-up: every AI agent the user owns + its X status. */
  @UseGuards(JwtAuthGuard)
  @Get('owned')
  async owned(@CurrentUser('id') userId: string) {
    return this.agentX.listOwnedWithStatus(userId);
  }

  @UseGuards(JwtAuthGuard)
  @HttpCode(200)
  @Delete(':listingId')
  async disconnect(@CurrentUser('id') userId: string, @Param('listingId') listingId: string) {
    await this.agentX.assertOwner(listingId, userId);
    await this.agentX.disconnect(listingId);
    return { ok: true };
  }

  // ─── Phase 2 — autonomous tweeting ──────────────────────────────────

  /** Get the seller's autonomous-mode prefs for a listing. Drives the
   *  toggles in the setup-x autonomous panel. */
  @UseGuards(JwtAuthGuard)
  @Get(':listingId/autonomous')
  async autonomousConfig(@CurrentUser('id') userId: string, @Param('listingId') listingId: string) {
    await this.agentX.assertOwner(listingId, userId);
    return this.autonomous.getConfig(listingId);
  }

  /** Patch any subset of the autonomous prefs. Used by the toggles +
   *  interval slider in the autonomous panel. */
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Patch(':listingId/autonomous')
  async updateAutonomous(
    @CurrentUser('id') userId: string,
    @Param('listingId') listingId: string,
    @Body()
    body: {
      autonomousEnabled?: boolean;
      postIntervalHours?: number;
      requireApproval?: boolean;
      mentionsEnabled?: boolean;
    },
  ) {
    await this.agentX.assertOwner(listingId, userId);
    return this.autonomous.updateConfig(listingId, body ?? {});
  }

  /** List queued / posted / failed proposals. The frontend calls this
   *  with `?status=PENDING_APPROVAL` to render the approval tray and
   *  with no filter to render history. */
  @UseGuards(JwtAuthGuard)
  @Get(':listingId/queue')
  async listQueue(
    @CurrentUser('id') userId: string,
    @Param('listingId') listingId: string,
    @Query('status') status?: string,
  ) {
    await this.agentX.assertOwner(listingId, userId);
    const validStatuses = ['PENDING_APPROVAL', 'POSTED', 'FAILED', 'REJECTED'] as const;
    type Q = (typeof validStatuses)[number];
    const q =
      status && (validStatuses as readonly string[]).includes(status) ? (status as Q) : undefined;
    return this.autonomous.listQueue(listingId, q);
  }

  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post(':listingId/queue/:postId/approve')
  async approve(
    @CurrentUser('id') userId: string,
    @Param('listingId') listingId: string,
    @Param('postId') postId: string,
  ) {
    await this.agentX.assertOwner(listingId, userId);
    return this.autonomous.approve(listingId, postId);
  }

  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post(':listingId/queue/:postId/reject')
  async reject(
    @CurrentUser('id') userId: string,
    @Param('listingId') listingId: string,
    @Param('postId') postId: string,
  ) {
    await this.agentX.assertOwner(listingId, userId);
    return this.autonomous.reject(listingId, postId);
  }

  /** Manual "ask the agent now" trigger — useful for the seller to
   *  test the webhook contract without waiting up to N hours. */
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post(':listingId/decide-now')
  async decideNow(@CurrentUser('id') userId: string, @Param('listingId') listingId: string) {
    await this.agentX.assertOwner(listingId, userId);
    return this.autonomous.decideNow(listingId);
  }
}

function sanitizeReturnTo(raw: string | null, fe: string, listingId: string): string {
  // Default landing — wizard for the listing the user just connected.
  const defaultDest = `${fe}/market/agents/${listingId}`;
  if (!raw) return defaultDest;
  try {
    if (raw.startsWith('/')) return `${fe}${raw}`;
    const u = new URL(raw);
    const f = new URL(fe);
    if (u.host === f.host) return raw;
  } catch {
    /* fall through */
  }
  return defaultDest;
}
