import * as crypto from 'crypto';

import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import axios from 'axios';

import { decryptToken, encryptToken } from '../../common/crypto/token-cipher.util';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RedisService } from '../../common/redis/redis.service';

import { buildAuthHeader, Oauth1Credentials } from './oauth1.util';
import { composeLaunchTweet } from './x.service';

/**
 * Per-AI-agent X (Twitter) integration — Bring Your Own X App.
 *
 * Each AI_AGENT MarketListing carries its own X Developer App
 * (clientId + clientSecret) plus the OAuth-issued tokens for the
 * X account that agent will tweet AS. This sidesteps the X API
 * pricing cliff (Free tier rejects POST /2/tweets with 402) by
 * pushing the API quota onto the seller's own developer account.
 *
 * Lifecycle of an AgentXConnection row:
 *   1. Seller pastes Client ID + Secret in the wizard
 *      → POST /social/agent-x/:listingId/setup
 *      → upsert row with `clientIdEnc` + `clientSecretEnc`, OAuth fields null
 *   2. Seller clicks "Connect X account"
 *      → GET  /social/agent-x/:listingId/connect-url
 *      → service generates PKCE + state, persists verifier in Redis
 *      → redirect to x.com/i/oauth2/authorize using THE LISTING'S clientId
 *   3. X redirects to /social/agent-x/callback with code + state
 *      → service exchanges code using the listing's clientSecret
 *      → fills xUserId, screenName, accessTokenEnc, refreshTokenEnc, expiresAt
 *      → redirect back to the wizard with ?x_connected=@handle
 *   4. Auto-tweet path: POST /social/x/post-launch sees `listingId`
 *      → looks up AgentXConnection
 *      → refreshes token if needed (using THIS listing's clientSecret)
 *      → posts using the listing's bearer token
 */
@Injectable()
export class AgentXService {
  private readonly logger = new Logger(AgentXService.name);
  private static readonly STATE_TTL_SEC = 600;
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
  ) {}

  // ─── Listing-owner gate ────────────────────────────────────────────

  /** Throws if the calling user does not own this listing. Used by every
   *  setup / connect / disconnect endpoint to prevent one seller from
   *  hijacking another seller's agent's X. */
  async assertOwner(listingId: string, userId: string): Promise<void> {
    const listing = await this.prisma.marketListing.findUnique({
      where: { id: listingId },
      select: { sellerId: true, type: true },
    });
    if (!listing) throw new NotFoundException('Listing not found');
    if (listing.sellerId !== userId) {
      throw new ForbiddenException('You do not own this listing');
    }
    if (listing.type !== 'AI_AGENT') {
      throw new BadRequestException('Only AI_AGENT listings can connect an X account');
    }
  }

  // ─── Step 1: store the seller's X App credentials ─────────────────

  async upsertAppCredentials(
    listingId: string,
    clientId: string,
    clientSecret: string,
  ): Promise<{ ok: true; hasOAuth: boolean }> {
    const cid = clientId.trim();
    const cs = clientSecret.trim();
    if (!cid || !cs) {
      throw new BadRequestException('Both Client ID and Client Secret are required');
    }
    if (cid.length > 200 || cs.length > 200) {
      throw new BadRequestException(
        'Credentials look unreasonably long — double-check what you pasted',
      );
    }
    const existing = await this.prisma.agentXConnection.findUnique({
      where: { listingId },
      select: { id: true, accessTokenEnc: true },
    });
    await this.prisma.agentXConnection.upsert({
      where: { listingId },
      create: {
        listingId,
        clientIdEnc: encryptToken(cid),
        clientSecretEnc: encryptToken(cs),
      },
      update: {
        clientIdEnc: encryptToken(cid),
        clientSecretEnc: encryptToken(cs),
        // Rotating the app credentials invalidates any prior OAuth
        // tokens — they were minted for the old clientId. Wipe so the
        // user is forced to re-OAuth.
        ...(existing
          ? {
              accessTokenEnc: null,
              refreshTokenEnc: null,
              expiresAt: null,
              xUserId: null,
              screenName: null,
              postsLast24h: 0,
              postsWindowStart: new Date(),
            }
          : {}),
      },
    });
    return { ok: true, hasOAuth: !!existing?.accessTokenEnc };
  }

  // ─── Step 2: generate the OAuth authorize URL using THE LISTING's app ──

  async generateAuthUrl(
    listingId: string,
    userId: string,
    returnTo: string | undefined,
    opts?: { forceLogin?: boolean },
  ): Promise<{ url: string }> {
    const row = await this.prisma.agentXConnection.findUnique({ where: { listingId } });
    if (!row) {
      throw new BadRequestException('Save your X App credentials first (Client ID + Secret).');
    }
    const clientId = decryptToken(row.clientIdEnc);
    if (!clientId) {
      throw new BadRequestException('Stored Client ID is corrupt — re-paste your credentials');
    }
    const redirectUri = this.requireRedirectUri();

    const verifier = b64url(crypto.randomBytes(48));
    const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
    const state = b64url(crypto.randomBytes(24));

    await this.redis
      .set(
        this.stateKey(state),
        JSON.stringify({ listingId, userId, verifier, returnTo: returnTo ?? null }),
        AgentXService.STATE_TTL_SEC,
      )
      .catch((err) => this.logger.warn(`OAuth state persist failed: ${(err as Error).message}`));

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: redirectUri,
      scope: AgentXService.SCOPES,
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
    });
    if (opts?.forceLogin) {
      params.set('force_login', 'true');
      params.set('prompt', 'login');
    }
    return { url: `${AgentXService.OAUTH_AUTH_URL}?${params.toString()}` };
  }

  // ─── Step 3: handle the callback X bounces back to ────────────────

  async handleCallback(
    code: string,
    state: string,
  ): Promise<{ listingId: string; screenName: string; returnTo: string | null }> {
    if (!code || !state) throw new BadRequestException('missing code or state');

    const stashed = await this.redis.get(this.stateKey(state)).catch(() => null);
    if (!stashed) throw new ForbiddenException('OAuth state expired or unknown');
    await this.redis.del(this.stateKey(state)).catch(() => null);

    let parsed: { listingId: string; userId: string; verifier: string; returnTo: string | null };
    try {
      parsed = JSON.parse(stashed);
    } catch {
      throw new ForbiddenException('OAuth state corrupt');
    }

    const row = await this.prisma.agentXConnection.findUnique({
      where: { listingId: parsed.listingId },
    });
    if (!row) throw new BadRequestException('Listing X credentials missing');
    const clientId = decryptToken(row.clientIdEnc);
    const clientSecret = decryptToken(row.clientSecretEnc);
    if (!clientId || !clientSecret) {
      throw new BadRequestException('Stored credentials are corrupt — re-paste them');
    }

    const tokens = await this.exchangeCode(clientId, clientSecret, code, parsed.verifier);
    const profile = await this.fetchMe(tokens.access_token);

    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);
    await this.prisma.agentXConnection.update({
      where: { listingId: parsed.listingId },
      data: {
        xUserId: profile.id,
        screenName: profile.username,
        accessTokenEnc: encryptToken(tokens.access_token),
        refreshTokenEnc: encryptToken(tokens.refresh_token),
        expiresAt,
        scopes: tokens.scope ?? AgentXService.SCOPES,
        postsLast24h: 0,
        postsWindowStart: new Date(),
      },
    });
    return {
      listingId: parsed.listingId,
      screenName: profile.username,
      returnTo: parsed.returnTo,
    };
  }

  // ─── Read / write helpers ─────────────────────────────────────────

  async getStatus(listingId: string) {
    const row = await this.prisma.agentXConnection.findUnique({ where: { listingId } });
    if (!row) return { configured: false as const, connected: false as const, authMethod: null };
    const oauth1Connected = !!(
      row.oauth1ConsumerKeyEnc &&
      row.oauth1ConsumerSecretEnc &&
      row.oauth1AccessTokenEnc &&
      row.oauth1AccessTokenSecretEnc
    );
    const oauth2Connected = !!row.accessTokenEnc;
    const connected = oauth1Connected || oauth2Connected;
    return {
      configured: true as const,
      connected,
      authMethod: oauth1Connected
        ? ('oauth1' as const)
        : oauth2Connected
          ? ('oauth2' as const)
          : null,
      screenName: row.screenName,
      postsLast24h: row.postsLast24h,
      dailyCap: AgentXService.DAILY_POST_CAP,
      connectedAt: connected ? row.updatedAt.toISOString() : null,
    };
  }

  async disconnect(listingId: string): Promise<void> {
    await this.prisma.agentXConnection.deleteMany({ where: { listingId } });
  }

  /** All AI_AGENT listings owned by `userId`, each annotated with its
   *  X connection status. Drives the per-agent X manager in /profile so
   *  sellers can see which of their agents need setup at a glance. */
  async listOwnedWithStatus(userId: string) {
    const listings = await this.prisma.marketListing.findMany({
      where: { sellerId: userId, type: 'AI_AGENT' },
      select: {
        id: true,
        title: true,
        status: true,
        createdAt: true,
        agentXConnection: {
          select: {
            screenName: true,
            accessTokenEnc: true,
            oauth1AccessTokenEnc: true,
            postsLast24h: true,
            updatedAt: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    return listings.map((l) => {
      const x = l.agentXConnection;
      const oauth1Connected = !!x?.oauth1AccessTokenEnc;
      const oauth2Connected = !!x?.accessTokenEnc;
      const status = x
        ? {
            configured: true as const,
            connected: oauth1Connected || oauth2Connected,
            authMethod: oauth1Connected
              ? ('oauth1' as const)
              : oauth2Connected
                ? ('oauth2' as const)
                : null,
            screenName: x.screenName,
            postsLast24h: x.postsLast24h,
            connectedAt: oauth1Connected || oauth2Connected ? x.updatedAt.toISOString() : null,
          }
        : { configured: false as const, connected: false as const, authMethod: null };
      return {
        listingId: l.id,
        title: l.title,
        listingStatus: l.status,
        createdAt: l.createdAt.toISOString(),
        x: status,
      };
    });
  }

  // ─── OAuth 1.0a path (BYO 4 keys, no redirect) ─────────────────────
  //
  // The simpler alternative to OAuth 2.0. Seller pastes 4 keys
  // (Consumer Key, Consumer Secret, Access Token, Access Token
  // Secret) generated directly in developer.x.com → Keys and Tokens.
  // No OAuth dance, no callback URL fiddling. Works on X Free tier
  // for accounts that have the endpoint enabled (the OAuth 2.0 path
  // gets 402 from Free, this one usually doesn't).

  /** Validate the 4 keys against /2/users/me, then persist them
   *  encrypted. On success captures the X account's screen name so
   *  the rest of the system (status pills, profile rows, post-launch
   *  tweet) can show "Connected as @handle" without a separate fetch.
   *  Wipes any prior OAuth 2.0 state so the post-router knows to use
   *  the 1.0a path. */
  async saveOauth1Credentials(
    listingId: string,
    creds: Oauth1Credentials,
  ): Promise<{ ok: true; screenName: string }> {
    const { consumerKey, consumerSecret, accessToken, accessTokenSecret } = creds;
    if (!consumerKey || !consumerSecret || !accessToken || !accessTokenSecret) {
      throw new BadRequestException(
        'All four keys are required (API Key, API Key Secret, Access Token, Access Token Secret)',
      );
    }
    if (
      consumerKey.length > 200 ||
      consumerSecret.length > 200 ||
      accessToken.length > 200 ||
      accessTokenSecret.length > 200
    ) {
      throw new BadRequestException('A key looks unreasonably long — double-check what you pasted');
    }

    // Verify by calling /2/users/me with these creds. If X accepts
    // the auth, we're good; if not we surface the verbatim error so
    // the seller knows whether they pasted wrong, the keys are
    // expired, or the app has the wrong permissions (Read-only).
    const url = AgentXService.USERS_ME_URL;
    const authHeader = buildAuthHeader('GET', url, {}, creds);
    let res;
    try {
      res = await axios.get<{ data?: { id: string; username: string } }>(url, {
        headers: { Authorization: authHeader },
        timeout: 8000,
        validateStatus: () => true,
      });
    } catch (err) {
      throw new BadRequestException(
        `Could not reach X with these keys: ${(err as Error).message ?? 'network error'}`,
      );
    }
    if (res.status === 401 || res.status === 403) {
      throw new BadRequestException(
        `X rejected these keys (HTTP ${res.status}). Make sure all four are from the SAME app, App permissions = Read and write, and the Access Token was generated for the account that should tweet.`,
      );
    }
    if (res.status !== 200 || !res.data?.data?.id) {
      throw new BadRequestException(
        `X returned an unexpected response (HTTP ${res.status}). Try regenerating the Access Token and pasting again.`,
      );
    }
    const screenName = res.data.data.username;
    const xUserId = res.data.data.id;

    await this.prisma.agentXConnection.upsert({
      where: { listingId },
      create: {
        listingId,
        // Reuse the OAuth-2 columns minimally — clientId/Secret are
        // required NOT NULL in the schema, so we stash a marker that
        // says "OAuth 1.0a row" so the rest of the system doesn't try
        // to refresh-or-redirect-with-them.
        clientIdEnc: encryptToken('oauth1'),
        clientSecretEnc: encryptToken('oauth1'),
        oauth1ConsumerKeyEnc: encryptToken(consumerKey),
        oauth1ConsumerSecretEnc: encryptToken(consumerSecret),
        oauth1AccessTokenEnc: encryptToken(accessToken),
        oauth1AccessTokenSecretEnc: encryptToken(accessTokenSecret),
        xUserId,
        screenName,
      },
      update: {
        oauth1ConsumerKeyEnc: encryptToken(consumerKey),
        oauth1ConsumerSecretEnc: encryptToken(consumerSecret),
        oauth1AccessTokenEnc: encryptToken(accessToken),
        oauth1AccessTokenSecretEnc: encryptToken(accessTokenSecret),
        xUserId,
        screenName,
        // Switching auth method invalidates any stale OAuth 2 tokens.
        accessTokenEnc: null,
        refreshTokenEnc: null,
        expiresAt: null,
        postsLast24h: 0,
        postsWindowStart: new Date(),
      },
    });
    return { ok: true, screenName };
  }

  /** Public alias of {@link loadOauth1Creds} for the autonomous service
   *  to reuse the decryption path without duplicating it. Same return
   *  shape: null when the listing is not on OAuth 1.0a. */
  async loadOauth1CredsForListing(listingId: string): Promise<Oauth1Credentials | null> {
    return this.loadOauth1Creds(listingId);
  }

  /** Public OAuth 1.0a header builder so the autonomous service can
   *  sign read-paths (mentions list, profile lookups) without
   *  re-importing the util everywhere. */
  buildOauth1Header(
    method: string,
    url: string,
    params: Record<string, string>,
    creds: Oauth1Credentials,
  ): string {
    return buildAuthHeader(method, url, params, creds);
  }

  /** Public wrapper around {@link postTweetOauth1} for the autonomous
   *  service. Optionally takes `inReplyToTweetId` so a queued mention
   *  reply threads under the original tweet via X's reply.in_reply_to
   *  field. */
  async postTweetForListing(
    listingId: string,
    text: string,
    opts?: { inReplyToTweetId?: string },
  ): Promise<{ id: string; text: string }> {
    const creds = await this.loadOauth1Creds(listingId);
    if (!creds) {
      throw new ForbiddenException('Listing has no OAuth 1.0a credentials configured');
    }
    return this.postTweetOauth1(listingId, creds, text, opts);
  }

  /** Internal — pull decrypted OAuth 1.0a creds for a listing, or null
   *  if the row is configured for OAuth 2.0 instead. */
  private async loadOauth1Creds(listingId: string): Promise<Oauth1Credentials | null> {
    const row = await this.prisma.agentXConnection.findUnique({ where: { listingId } });
    if (!row) return null;
    if (
      !row.oauth1ConsumerKeyEnc ||
      !row.oauth1ConsumerSecretEnc ||
      !row.oauth1AccessTokenEnc ||
      !row.oauth1AccessTokenSecretEnc
    ) {
      return null;
    }
    const consumerKey = decryptToken(row.oauth1ConsumerKeyEnc);
    const consumerSecret = decryptToken(row.oauth1ConsumerSecretEnc);
    const accessToken = decryptToken(row.oauth1AccessTokenEnc);
    const accessTokenSecret = decryptToken(row.oauth1AccessTokenSecretEnc);
    if (!consumerKey || !consumerSecret || !accessToken || !accessTokenSecret) return null;
    return { consumerKey, consumerSecret, accessToken, accessTokenSecret };
  }

  /** Post a tweet via OAuth 1.0a. Same return shape as the OAuth 2
   *  postTweet so the launch-tweet caller is auth-agnostic. When
   *  `opts.inReplyToTweetId` is set the request includes the v2
   *  `reply.in_reply_to_tweet_id` field so the tweet threads as a
   *  reply (used by the autonomous service for mention replies). */
  private async postTweetOauth1(
    listingId: string,
    creds: Oauth1Credentials,
    text: string,
    opts?: { inReplyToTweetId?: string },
  ): Promise<{ id: string; text: string }> {
    const trimmed = (text ?? '').trim();
    if (!trimmed) throw new BadRequestException('empty tweet');
    if (trimmed.length > 280) throw new BadRequestException('tweet over 280 chars');

    // OAuth 1.0a + JSON body: the body does NOT participate in the
    // signature base string — only the OAuth params do. We sign
    // accordingly (empty params object in buildAuthHeader).
    const url = AgentXService.TWEETS_URL;
    const authHeader = buildAuthHeader('POST', url, {}, creds);

    const payload: Record<string, unknown> = { text: trimmed };
    if (opts?.inReplyToTweetId) {
      payload.reply = { in_reply_to_tweet_id: opts.inReplyToTweetId };
    }

    let res;
    try {
      res = await axios.post(url, payload, {
        headers: {
          Authorization: authHeader,
          'Content-Type': 'application/json',
        },
        timeout: 10_000,
        validateStatus: () => true,
      });
    } catch (err) {
      throw new HttpException(
        `Could not reach X: ${(err as Error).message ?? 'network error'}`,
        502,
      );
    }
    if (res.status === 402) {
      // X moved to pay-per-use in Feb 2026: every write requires
      // pre-funded credits in the dev portal. There's nothing we can
      // do server-side; surface a precise reason so the FE can route
      // the seller straight to developer.x.com to fund their account.
      const data = res.data as
        | { detail?: string; title?: string; errors?: Array<{ message?: string }> }
        | undefined;
      const msg =
        data?.detail || data?.title || data?.errors?.[0]?.message || 'pay-per-use credits required';
      throw new HttpException(`X requires API credits to post: ${msg}`, 402);
    }
    if (res.status === 401 || res.status === 403) {
      const data = res.data as
        | { detail?: string; title?: string; errors?: Array<{ message?: string }> }
        | undefined;
      const msg = data?.detail || data?.title || data?.errors?.[0]?.message || `http_${res.status}`;
      throw new HttpException(`X refused tweet (${res.status}): ${msg}`, res.status);
    }
    if (res.status >= 400) {
      const data = res.data as
        | { detail?: string; title?: string; errors?: Array<{ message?: string }> }
        | undefined;
      const msg = data?.detail || data?.title || data?.errors?.[0]?.message || `http_${res.status}`;
      throw new HttpException(`X API ${res.status}: ${msg}`, res.status);
    }
    const out = res.data?.data ?? {};
    await this.prisma.agentXConnection.update({
      where: { listingId },
      data: { postsLast24h: { increment: 1 } },
    });
    return { id: String(out.id ?? ''), text: String(out.text ?? trimmed) };
  }

  /** Compose + post the launch-announcement tweet for a freshly
   *  minted token. Uses the listing's own X app credentials end to
   *  end. Returns the same shape the FE pill expects. */
  async postLaunchTweet(
    listingId: string,
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
        reason:
          | 'not_configured'
          | 'not_connected'
          | 'cap_reached'
          | 'reauth'
          | 'no_credits'
          | 'failed';
        detail?: string;
      }
  > {
    const row = await this.prisma.agentXConnection.findUnique({ where: { listingId } });
    if (!row) return { posted: false, reason: 'not_configured' };

    // Auth-method dispatch. OAuth 1.0a takes precedence when present
    // (no redirect flow, simpler key paste). Fallback to OAuth 2.0
    // for rows that pre-date the 1.0a flow.
    const oauth1 = await this.loadOauth1Creds(listingId);
    const text = composeLaunchTweet(input);

    if (oauth1) {
      try {
        const out = await this.postTweetOauth1(listingId, oauth1, text);
        return {
          posted: true,
          id: out.id,
          screenName: row.screenName ?? 'unknown',
          text: out.text,
        };
      } catch (err) {
        const status = err instanceof HttpException ? err.getStatus() : 0;
        const msg = (err as Error)?.message ?? '';
        if (status === 402) return { posted: false, reason: 'no_credits', detail: msg };
        this.logger.warn(`agent-x oauth1 post failed for listing=${listingId}: ${msg}`);
        return { posted: false, reason: 'failed', detail: msg };
      }
    }

    if (!row.accessTokenEnc) return { posted: false, reason: 'not_connected' };

    try {
      const out = await this.postTweet(listingId, text);
      return { posted: true, id: out.id, screenName: row.screenName ?? 'unknown', text: out.text };
    } catch (err) {
      const status = err instanceof HttpException ? err.getStatus() : 0;
      const msg = (err as Error)?.message ?? '';
      if (status === 402) return { posted: false, reason: 'no_credits', detail: msg };
      if (err instanceof ForbiddenException) {
        if (/cap reached/i.test(msg)) {
          return { posted: false, reason: 'cap_reached', detail: msg };
        }
        return { posted: false, reason: 'reauth', detail: msg };
      }
      this.logger.warn(`agent-x post failed for listing=${listingId}: ${msg}`);
      return { posted: false, reason: 'failed', detail: msg };
    }
  }

  // ─── Internals ────────────────────────────────────────────────────

  private async postTweet(listingId: string, text: string): Promise<{ id: string; text: string }> {
    const trimmed = (text ?? '').trim();
    if (!trimmed) throw new BadRequestException('empty tweet');
    if (trimmed.length > 280) throw new BadRequestException('tweet over 280 chars');

    const row = await this.prisma.agentXConnection.findUnique({ where: { listingId } });
    if (!row || !row.accessTokenEnc) {
      throw new NotFoundException('Agent X not connected');
    }

    const now = new Date();
    const inFreshWindow = now.getTime() - row.postsWindowStart.getTime() >= 24 * 60 * 60 * 1000;
    if (!inFreshWindow && row.postsLast24h >= AgentXService.DAILY_POST_CAP) {
      throw new ForbiddenException(
        `daily X post cap reached (${AgentXService.DAILY_POST_CAP}/24h)`,
      );
    }

    const accessToken = await this.ensureFreshAccessToken(listingId);

    let res;
    try {
      res = await axios.post(
        AgentXService.TWEETS_URL,
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
      this.logger.warn(`agent-x tweet failed (${status}): ${JSON.stringify(data)}`);
      if (status === 401) throw new ForbiddenException('X token rejected, please reconnect');
      if (status === 402) {
        throw new HttpException(`X requires API credits to post: ${xMessage}`, 402);
      }
      if (status === 403) throw new HttpException(`X refused tweet (403): ${xMessage}`, 403);
      if (status === 429) throw new HttpException(`X rate-limited (429): ${xMessage}`, 429);
      throw new HttpException(
        `X API ${status}: ${xMessage}`,
        status >= 400 && status < 600 ? status : 502,
      );
    }

    await this.prisma.agentXConnection.update({
      where: { listingId },
      data: inFreshWindow
        ? { postsLast24h: 1, postsWindowStart: now }
        : { postsLast24h: { increment: 1 } },
    });
    const out = res.data?.data ?? {};
    return { id: String(out.id ?? ''), text: String(out.text ?? trimmed) };
  }

  private async ensureFreshAccessToken(listingId: string): Promise<string> {
    const row = await this.prisma.agentXConnection.findUnique({ where: { listingId } });
    if (!row || !row.accessTokenEnc || !row.expiresAt) {
      throw new NotFoundException('Agent X not connected');
    }
    const fresh = row.expiresAt.getTime() - Date.now() > AgentXService.REFRESH_BUFFER_MS;
    if (fresh) {
      const tok = decryptToken(row.accessTokenEnc);
      if (tok) return tok;
    }
    const refreshTok = decryptToken(row.refreshTokenEnc);
    const clientId = decryptToken(row.clientIdEnc);
    const clientSecret = decryptToken(row.clientSecretEnc);
    if (!refreshTok || !clientId || !clientSecret) {
      throw new ForbiddenException('refresh token missing, please reconnect');
    }
    const fresh2 = await this.refreshTokens(clientId, clientSecret, refreshTok);
    await this.prisma.agentXConnection.update({
      where: { listingId },
      data: {
        accessTokenEnc: encryptToken(fresh2.access_token),
        refreshTokenEnc: encryptToken(fresh2.refresh_token ?? refreshTok),
        expiresAt: new Date(Date.now() + fresh2.expires_in * 1000),
        scopes: fresh2.scope ?? row.scopes,
      },
    });
    return fresh2.access_token;
  }

  private async exchangeCode(
    clientId: string,
    clientSecret: string,
    code: string,
    verifier: string,
  ) {
    const redirectUri = this.requireRedirectUri();
    const body = new URLSearchParams({
      code,
      grant_type: 'authorization_code',
      client_id: clientId,
      redirect_uri: redirectUri,
      code_verifier: verifier,
    });
    const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const res = await axios.post<TokenResponse>(AgentXService.OAUTH_TOKEN_URL, body.toString(), {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${auth}`,
      },
      timeout: 8000,
    });
    return res.data;
  }

  private async refreshTokens(clientId: string, clientSecret: string, refreshToken: string) {
    const body = new URLSearchParams({
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
      client_id: clientId,
    });
    const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const res = await axios.post<TokenResponse>(AgentXService.OAUTH_TOKEN_URL, body.toString(), {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${auth}`,
      },
      timeout: 8000,
    });
    return res.data;
  }

  private async fetchMe(accessToken: string): Promise<{ id: string; username: string }> {
    const res = await axios.get<{ data: { id: string; username: string } }>(
      AgentXService.USERS_ME_URL,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        timeout: 6000,
      },
    );
    return { id: res.data.data.id, username: res.data.data.username };
  }

  private requireRedirectUri(): string {
    const v = process.env.X_AGENT_REDIRECT_URI || process.env.X_REDIRECT_URI;
    if (!v) throw new Error('X_AGENT_REDIRECT_URI (or X_REDIRECT_URI) is not configured');
    return v;
  }

  private stateKey(state: string): string {
    return `agent-x:oauth:state:${state}`;
  }
}

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope?: string;
  token_type?: string;
}

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
