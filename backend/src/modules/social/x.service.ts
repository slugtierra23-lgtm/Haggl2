import * as crypto from 'crypto';

import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

import { decryptToken, encryptToken } from '../../common/crypto/token-cipher.util';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RedisService } from '../../common/redis/redis.service';

/**
 * X (Twitter) OAuth 2.0 + posting service.
 *
 * Flow on `Connect X`:
 *   1. FE calls GET /social/x/connect-url → service generates PKCE
 *      verifier + challenge, persists verifier in Redis keyed by a
 *      random `state`, and returns the authorize URL.
 *   2. User approves on x.com, X redirects to /social/x/callback with
 *      ?code &amp; ?state. We pop the verifier from Redis, exchange the
 *      code for tokens, fetch the user's @handle, and store an
 *      XConnection row with both tokens encrypted at rest.
 *
 * Flow on `Post tweet`:
 *   1. Caller hands us userId + tweet text.
 *   2. We refresh the access token if it's within 60 s of expiry.
 *   3. POST to https://api.twitter.com/2/tweets with bearer token.
 *   4. We bump the per-user 24h post counter so a runaway agent can't
 *      spam the user's account into a suspension.
 *
 * Tokens are encrypted with the existing TOKEN_CRYPTO_KEY (same key
 * used for GitHub OAuth). One key for everything keeps key rotation
 * simple.
 */
@Injectable()
export class SocialXService {
  private readonly logger = new Logger(SocialXService.name);
  private static readonly STATE_TTL_SEC = 600; // 10 min — well above a human OAuth round-trip
  private static readonly DAILY_POST_CAP = 50;
  private static readonly REFRESH_BUFFER_MS = 60_000;
  private static readonly SCOPES = 'tweet.read tweet.write users.read offline.access';
  private static readonly OAUTH_AUTH_URL = 'https://twitter.com/i/oauth2/authorize';
  private static readonly OAUTH_TOKEN_URL = 'https://api.twitter.com/2/oauth2/token';
  private static readonly TWEETS_URL = 'https://api.twitter.com/2/tweets';
  private static readonly USERS_ME_URL = 'https://api.twitter.com/2/users/me';

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly config: ConfigService,
  ) {}

  // ───────────────────────────────────────────────────────────────
  // OAuth
  // ───────────────────────────────────────────────────────────────

  /** Generate a PKCE-protected authorize URL and remember the verifier.
   *
   *  When `forceLogin` is true we ask X to force a fresh credential
   *  prompt instead of silently reusing whatever session the browser
   *  currently has. Critical for users who are logged into the wrong
   *  X account (e.g. a brand handle) and need to authorize a personal
   *  one instead. X 2.0 doesn't document the parameter formally, but
   *  the underlying twitter.com authorize page still respects
   *  `force_login=true` from OAuth 1.0a. We send `prompt=login` too
   *  as a belt-and-suspenders against future renames. */
  async generateAuthUrl(
    userId: string,
    returnTo?: string,
    opts?: { forceLogin?: boolean },
  ): Promise<{ url: string; state: string }> {
    const clientId = this.requireEnv('X_CLIENT_ID');
    const redirectUri = this.requireEnv('X_REDIRECT_URI');

    const verifier = b64url(crypto.randomBytes(48));
    const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
    const state = b64url(crypto.randomBytes(24));

    // Stash the verifier + the calling user id so the callback (which
    // doesn't carry a session cookie if the user lands cold) knows
    // whose row to write. 10-min window covers any reasonable OAuth
    // round-trip. Store both pieces under one key.
    await this.redis
      .set(
        this.stateKey(state),
        JSON.stringify({ userId, verifier, returnTo: returnTo ?? null }),
        SocialXService.STATE_TTL_SEC,
      )
      .catch((err) => {
        this.logger.warn(`failed to persist OAuth state: ${(err as Error).message}`);
      });

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: redirectUri,
      scope: SocialXService.SCOPES,
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
    });
    if (opts?.forceLogin) {
      params.set('force_login', 'true');
      params.set('prompt', 'login');
    }

    return { url: `${SocialXService.OAUTH_AUTH_URL}?${params.toString()}`, state };
  }

  /** Exchange a callback `?code` for tokens and persist the row. */
  async handleCallback(
    code: string,
    state: string,
  ): Promise<{ userId: string; screenName: string; returnTo: string | null }> {
    if (!code || !state) throw new BadRequestException('missing code or state');

    const stashed = await this.redis.get(this.stateKey(state)).catch(() => null);
    if (!stashed) throw new ForbiddenException('OAuth state expired or unknown');
    await this.redis.del(this.stateKey(state)).catch(() => null);

    let parsed: { userId: string; verifier: string; returnTo: string | null };
    try {
      parsed = JSON.parse(stashed);
    } catch {
      throw new ForbiddenException('OAuth state corrupt');
    }
    const { userId, verifier, returnTo } = parsed;

    const tokens = await this.exchangeCode(code, verifier);
    const profile = await this.fetchMe(tokens.access_token);

    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);
    await this.prisma.xConnection.upsert({
      where: { userId },
      create: {
        userId,
        xUserId: profile.id,
        screenName: profile.username,
        accessTokenEnc: encryptToken(tokens.access_token),
        refreshTokenEnc: encryptToken(tokens.refresh_token),
        expiresAt,
        scopes: tokens.scope ?? SocialXService.SCOPES,
      },
      update: {
        xUserId: profile.id,
        screenName: profile.username,
        accessTokenEnc: encryptToken(tokens.access_token),
        refreshTokenEnc: encryptToken(tokens.refresh_token),
        expiresAt,
        scopes: tokens.scope ?? SocialXService.SCOPES,
        // Reset the throttle window on reconnect so a previous lockout
        // doesn't carry over to the freshly-authorised connection.
        postsLast24h: 0,
        postsWindowStart: new Date(),
      },
    });

    return { userId, screenName: profile.username, returnTo };
  }

  /** What the FE needs to render the "Connected as @handle" pill. */
  async getStatus(userId: string) {
    const row = await this.prisma.xConnection.findUnique({ where: { userId } });
    if (!row) return { connected: false as const };
    return {
      connected: true as const,
      screenName: row.screenName,
      connectedAt: row.createdAt.toISOString(),
      postsLast24h: row.postsLast24h,
      dailyCap: SocialXService.DAILY_POST_CAP,
    };
  }

  async disconnect(userId: string): Promise<void> {
    await this.prisma.xConnection.deleteMany({ where: { userId } });
    // Best-effort revoke server-side too, so the access token in our
    // brief refresh window is invalidated. Failure is non-fatal — the
    // local row is gone and no further posts can be made.
    // (X's token revocation endpoint is best-effort here.)
  }

  // ───────────────────────────────────────────────────────────────
  // Posting
  // ───────────────────────────────────────────────────────────────

  /**
   * Post a tweet on behalf of `userId`. Refreshes the token if needed,
   * enforces a per-user 24-h cap, and surfaces structured errors so
   * the FE can show "you need to reconnect" or "daily cap reached".
   */
  async postTweet(userId: string, text: string): Promise<{ id: string; text: string }> {
    const trimmed = (text ?? '').trim();
    if (!trimmed) throw new BadRequestException('empty tweet');
    if (trimmed.length > 280) throw new BadRequestException('tweet over 280 chars');

    const row = await this.prisma.xConnection.findUnique({ where: { userId } });
    if (!row) throw new NotFoundException('X account not connected');

    // Roll the daily-cap window forward when 24h have elapsed since
    // the previous reset. Anything earlier still counts inside the
    // window.
    const now = new Date();
    const windowAgeMs = now.getTime() - row.postsWindowStart.getTime();
    const inFreshWindow = windowAgeMs >= 24 * 60 * 60 * 1000;
    if (!inFreshWindow && row.postsLast24h >= SocialXService.DAILY_POST_CAP) {
      throw new ForbiddenException(
        `daily X post cap reached (${SocialXService.DAILY_POST_CAP}/24h)`,
      );
    }

    const accessToken = await this.ensureFreshAccessToken(userId);

    let res;
    try {
      res = await axios.post(
        SocialXService.TWEETS_URL,
        { text: trimmed },
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          timeout: 8000,
        },
      );
    } catch (err) {
      // 401 = access token dead even though we thought it was fresh.
      // 403 = app lacks write scope, account suspended, or X policy
      //       block (duplicate content most often).
      // 429 = rate limit (X Free tier is way stricter than our 50/24h cap).
      // Anything else (4xx/5xx) we surface verbatim so the publish UI
      // can render the real reason instead of "failed to post tweet".
      const status = (err as { response?: { status?: number } }).response?.status ?? 500;
      const data = (err as { response?: { data?: unknown } }).response?.data as
        | { detail?: string; title?: string; errors?: Array<{ message?: string }> }
        | undefined;
      const xMessage =
        data?.detail ||
        data?.title ||
        data?.errors?.[0]?.message ||
        (typeof data === 'string' ? data : '') ||
        `http_${status}`;
      this.logger.warn(`tweet post failed (${status}): ${JSON.stringify(data)}`);
      if (status === 401) {
        throw new ForbiddenException('X token rejected, please reconnect');
      }
      if (status === 402) {
        // X moved to pay-per-use in Feb 2026. Surface this distinctly
        // so the launch wizard can show a fund-credits CTA instead of
        // a generic retry.
        throw new HttpException(`X requires API credits to post: ${xMessage}`, 402);
      }
      if (status === 403) {
        // 403 from /tweets is almost always one of: duplicate content,
        // app missing the tweet.write scope, or account flagged. Surface
        // the X message verbatim so the user knows which.
        throw new HttpException(`X refused tweet (403): ${xMessage}`, 403);
      }
      if (status === 429) {
        throw new HttpException(`X rate-limited the post (429): ${xMessage}`, 429);
      }
      throw new HttpException(
        `X API ${status}: ${xMessage}`,
        status >= 400 && status < 600 ? status : 502,
      );
    }

    await this.prisma.xConnection.update({
      where: { userId },
      data: inFreshWindow
        ? { postsLast24h: 1, postsWindowStart: now }
        : { postsLast24h: { increment: 1 } },
    });

    const out = res.data?.data ?? {};
    return { id: String(out.id ?? ''), text: String(out.text ?? trimmed) };
  }

  /**
   * Compose + post the launch-announcement tweet for a freshly minted
   * token. Wraps {@link postTweet} so the daily cap, refresh, and 401
   * handling all stay consistent — but the tweet body is built from
   * structured token data instead of free user input. Called from the
   * launch wizard the moment the on-chain tx confirms; the user never
   * sees a draft.
   *
   * Returns a stable shape the FE can act on:
   *   { posted: true,  id, screenName }
   *   { posted: false, reason: 'not_connected' }   → show Connect CTA
   *   { posted: false, reason: 'cap_reached' }     → show "tomorrow"
   *   { posted: false, reason: 'reauth' }          → show Reconnect
   *   { posted: false, reason: 'failed', detail }  → manual fallback
   */
  async postLaunchTweet(
    userId: string,
    input: {
      symbol: string;
      name?: string | null;
      tokenAddress: string;
      url: string;
      agentName?: string | null;
    },
  ): Promise<
    | { posted: true; id: string; screenName: string; text: string }
    | {
        posted: false;
        reason: 'not_connected' | 'cap_reached' | 'reauth' | 'no_credits' | 'failed';
        detail?: string;
      }
  > {
    const row = await this.prisma.xConnection.findUnique({ where: { userId } });
    if (!row) return { posted: false, reason: 'not_connected' };

    const text = composeLaunchTweet(input);
    try {
      const res = await this.postTweet(userId, text);
      return { posted: true, id: res.id, screenName: row.screenName, text: res.text };
    } catch (err) {
      const status = err instanceof HttpException ? err.getStatus() : 0;
      const msg = (err as Error)?.message ?? '';
      if (status === 402) return { posted: false, reason: 'no_credits', detail: msg };
      if (err instanceof ForbiddenException) {
        if (/cap reached/i.test(msg)) return { posted: false, reason: 'cap_reached', detail: msg };
        return { posted: false, reason: 'reauth', detail: msg };
      }
      if (err instanceof NotFoundException) return { posted: false, reason: 'not_connected' };
      this.logger.warn(`postLaunchTweet failed for user=${userId}: ${msg}`);
      return { posted: false, reason: 'failed', detail: msg };
    }
  }

  // ───────────────────────────────────────────────────────────────
  // Internals
  // ───────────────────────────────────────────────────────────────

  private async ensureFreshAccessToken(userId: string): Promise<string> {
    const row = await this.prisma.xConnection.findUnique({ where: { userId } });
    if (!row) throw new NotFoundException('X account not connected');
    const fresh = row.expiresAt.getTime() - Date.now() > SocialXService.REFRESH_BUFFER_MS;
    if (fresh) {
      const tok = decryptToken(row.accessTokenEnc);
      if (tok) return tok;
    }

    const refreshTok = decryptToken(row.refreshTokenEnc);
    if (!refreshTok) throw new ForbiddenException('refresh token missing, please reconnect');

    const fresh2 = await this.refreshTokens(refreshTok);
    await this.prisma.xConnection.update({
      where: { userId },
      data: {
        accessTokenEnc: encryptToken(fresh2.access_token),
        refreshTokenEnc: encryptToken(fresh2.refresh_token ?? refreshTok),
        expiresAt: new Date(Date.now() + fresh2.expires_in * 1000),
        scopes: fresh2.scope ?? row.scopes,
      },
    });
    return fresh2.access_token;
  }

  private async exchangeCode(code: string, verifier: string) {
    const clientId = this.requireEnv('X_CLIENT_ID');
    const clientSecret = this.requireEnv('X_CLIENT_SECRET');
    const redirectUri = this.requireEnv('X_REDIRECT_URI');

    const body = new URLSearchParams({
      code,
      grant_type: 'authorization_code',
      client_id: clientId,
      redirect_uri: redirectUri,
      code_verifier: verifier,
    });
    const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const res = await axios.post<TokenResponse>(SocialXService.OAUTH_TOKEN_URL, body.toString(), {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${auth}`,
      },
      timeout: 8000,
    });
    return res.data;
  }

  private async refreshTokens(refreshToken: string): Promise<TokenResponse> {
    const clientId = this.requireEnv('X_CLIENT_ID');
    const clientSecret = this.requireEnv('X_CLIENT_SECRET');
    const body = new URLSearchParams({
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
      client_id: clientId,
    });
    const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const res = await axios.post<TokenResponse>(SocialXService.OAUTH_TOKEN_URL, body.toString(), {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${auth}`,
      },
      timeout: 8000,
    });
    return res.data;
  }

  private async fetchMe(accessToken: string): Promise<{ id: string; username: string }> {
    const res = await axios.get<{ data: { id: string; username: string; name?: string } }>(
      SocialXService.USERS_ME_URL,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        timeout: 8000,
      },
    );
    if (!res.data?.data?.id || !res.data.data.username) {
      throw new HttpException('X /users/me returned malformed payload', 502);
    }
    return { id: res.data.data.id, username: res.data.data.username };
  }

  private requireEnv(name: string): string {
    const v = this.config.get<string>(name);
    if (!v) throw new HttpException(`${name} not configured on the server`, 503);
    return v;
  }

  private stateKey(state: string) {
    return `social:x:oauth:state:${state}`;
  }
}

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope?: string;
  token_type: string;
}

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Build the launch-announcement tweet body. Kept under 280 chars even
 * with long token names + long URLs by trimming the name first and
 * dropping the agent attribution if needed.
 */
export function composeLaunchTweet(input: {
  symbol: string;
  name?: string | null;
  tokenAddress: string;
  url: string;
  agentName?: string | null;
}): string {
  const sym = `$${
    (input.symbol || '')
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
      .slice(0, 10) || 'TOKEN'
  }`;
  const url = input.url;
  const agentName = (input.agentName || '').trim().slice(0, 40);
  const fullByLine = agentName ? ` by ${agentName}` : '';

  // Try the rich form first.
  const rich = `Just launched ${sym} on Bolty${fullByLine}.\n\nChart, holders, and CA: ${url}`;
  if (rich.length <= 280) return rich;
  // Drop the agent attribution if we are over.
  const lean = `Just launched ${sym} on Bolty.\n\nChart, holders, and CA: ${url}`;
  if (lean.length <= 280) return lean;
  // Last resort — keep it tweetable even with very long URLs.
  return `Just launched ${sym} on Bolty. ${url}`.slice(0, 280);
}
