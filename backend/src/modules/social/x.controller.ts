import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
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

import { AgentXService } from './agent-x.service';
import { SocialXService } from './x.service';

/**
 * X (Twitter) integration endpoints.
 *
 *   GET  /social/x/connect-url   → kick off OAuth (auth-required)
 *   GET  /social/x/callback      → OAuth redirect target (Public — X is the caller)
 *   GET  /social/x/status        → "connected as @handle" pill (auth)
 *   DELETE /social/x             → disconnect (auth)
 *   POST /social/x/post          → post a tweet on the user's behalf (auth)
 */
@Controller('social/x')
export class SocialXController {
  constructor(
    private readonly x: SocialXService,
    private readonly agentX: AgentXService,
  ) {}

  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Get('connect-url')
  async connectUrl(
    @CurrentUser('id') userId: string,
    @Query('returnTo') returnTo?: string,
    @Query('forceLogin') forceLogin?: string,
  ) {
    const force = forceLogin === '1' || forceLogin === 'true';
    const { url, state } = await this.x.generateAuthUrl(userId, returnTo, {
      forceLogin: force,
    });
    return { url, state };
  }

  /** Redirect target. X hits this with ?code &amp; ?state. We send the
   *  user back to the FE with a short-lived success/error fragment. */
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
    const fe = process.env.FRONTEND_URL || 'https://www.haggl.tech';
    if (error) {
      return res.redirect(302, `${fe}/profile?x_error=${encodeURIComponent(error)}`);
    }
    try {
      const { screenName, returnTo } = await this.x.handleCallback(code, state);
      const dest = sanitizeReturnTo(returnTo, fe);
      const sep = dest.includes('?') ? '&' : '?';
      return res.redirect(302, `${dest}${sep}x_connected=${encodeURIComponent(screenName)}`);
    } catch (err) {
      const msg = (err as Error).message ?? 'oauth_failed';
      return res.redirect(302, `${fe}/profile?x_error=${encodeURIComponent(msg)}`);
    }
  }

  @UseGuards(JwtAuthGuard)
  @Get('status')
  status(@CurrentUser('id') userId: string) {
    return this.x.getStatus(userId);
  }

  @UseGuards(JwtAuthGuard)
  @Delete()
  @HttpCode(200)
  async disconnect(@CurrentUser('id') userId: string) {
    await this.x.disconnect(userId);
    return { ok: true };
  }

  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('post')
  async post(@CurrentUser('id') userId: string, @Body() body: { text?: string }) {
    return this.x.postTweet(userId, body?.text ?? '');
  }

  /**
   * Auto-post the launch announcement for a freshly minted token.
   * Called by the launch wizard the moment the on-chain tx confirms,
   * with the structured token data (symbol, name, address, public URL,
   * optional agent name). The body is composed server-side so the user
   * never has to click a "send" button.
   *
   * Returns a structured shape so the FE can render the right state
   * inline (posted / cap reached / token expired / not connected /
   * generic failed) without parsing error strings.
   */
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('post-launch')
  async postLaunch(
    @CurrentUser('id') userId: string,
    @Body()
    body: {
      symbol?: string;
      name?: string | null;
      tokenAddress?: string;
      url?: string;
      agentName?: string | null;
      /** When provided, posts using THE LISTING'S X app credentials
       *  (per-agent BYO). Falls back to the user-level X connection
       *  when omitted, kept only for backwards-compatibility with any
       *  caller that still uses the old shape. New launches always
       *  pass listingId. */
      listingId?: string | null;
    },
  ) {
    const symbol = (body?.symbol ?? '').trim();
    const tokenAddress = (body?.tokenAddress ?? '').trim();
    const url = (body?.url ?? '').trim();
    if (!symbol || !tokenAddress || !url) {
      return { posted: false as const, reason: 'failed' as const, detail: 'missing fields' };
    }
    const listingId = body?.listingId?.trim() || null;
    if (listingId) {
      // Caller supplied a listing → BYO X path. Verify the caller
      // actually owns the listing before doing anything; otherwise a
      // hostile client could trigger another seller's agent to tweet.
      await this.agentX.assertOwner(listingId, userId);
      return this.agentX.postLaunchTweet(listingId, {
        symbol,
        name: body?.name ?? null,
        tokenAddress,
        url,
        agentName: body?.agentName ?? null,
      });
    }
    return this.x.postLaunchTweet(userId, {
      symbol,
      name: body?.name ?? null,
      tokenAddress,
      url,
      agentName: body?.agentName ?? null,
    });
  }
}

/** Only allow returnTo that lives on our own FE host so OAuth replies
 *  can't be redirected to attacker-controlled URLs. */
function sanitizeReturnTo(raw: string | null, fe: string): string {
  if (!raw) return `${fe}/profile`;
  try {
    if (raw.startsWith('/')) return `${fe}${raw}`;
    const u = new URL(raw);
    const f = new URL(fe);
    if (u.host === f.host) return raw;
  } catch {
    /* fall through */
  }
  return `${fe}/profile`;
}
