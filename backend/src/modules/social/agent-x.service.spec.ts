/* eslint-disable @typescript-eslint/no-explicit-any */
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import axios from 'axios';

import { AgentXService } from './agent-x.service';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

// In-memory fake of the parts of the Prisma client we touch. Keeps the
// tests hermetic — no real DB, no flakey integration. Mirrors the
// Prisma promise-shape (findUnique, upsert, update, deleteMany).
class FakePrisma {
  rows = new Map<string, any>();
  listings = new Map<string, { sellerId: string; type: string }>();

  marketListing = {
    findUnique: ({ where }: any) => Promise.resolve(this.listings.get(where.id) ?? null),
  };
  agentXConnection = {
    findUnique: ({ where }: any) => Promise.resolve(this.rows.get(where.listingId) ?? null),
    upsert: ({ where, create, update }: any) => {
      const existing = this.rows.get(where.listingId);
      const next = existing
        ? { ...existing, ...this.applyIncrements(update, existing), updatedAt: new Date() }
        : {
            id: `cuid-${where.listingId}`,
            createdAt: new Date(),
            updatedAt: new Date(),
            ...create,
          };
      this.rows.set(where.listingId, next);
      return Promise.resolve(next);
    },
    update: ({ where, data }: any) => {
      const cur = this.rows.get(where.listingId);
      if (!cur) return Promise.reject(new Error('row not found'));
      const next = { ...cur, ...this.applyIncrements(data, cur), updatedAt: new Date() };
      this.rows.set(where.listingId, next);
      return Promise.resolve(next);
    },
    deleteMany: ({ where }: any) => {
      this.rows.delete(where.listingId);
      return Promise.resolve({ count: 1 });
    },
  };

  private applyIncrements(update: any, existing: any): any {
    const out: any = {};
    for (const [k, v] of Object.entries(update)) {
      if (v && typeof v === 'object' && 'increment' in (v as any)) {
        out[k] = (existing[k] ?? 0) + (v as any).increment;
      } else {
        out[k] = v;
      }
    }
    return out;
  }
}

class FakeRedis {
  store = new Map<string, string>();
  set = jest.fn(async (k: string, v: string) => {
    this.store.set(k, v);
  });
  get = jest.fn(async (k: string) => this.store.get(k) ?? null);
  del = jest.fn(async (k: string) => {
    this.store.delete(k);
  });
}

function makeService() {
  process.env.X_REDIRECT_URI = 'https://api.haggl.tech/api/v1/social/agent-x/callback';
  // Cipher util expects TOKEN_CRYPTO_KEY to be a base64 string that
  // decodes to exactly 32 bytes (AES-256). Anything else makes it
  // silently fall back to plaintext storage, which would mask bugs in
  // tests. 32 bytes of 0x42 → 44-char base64.
  process.env.TOKEN_CRYPTO_KEY = Buffer.alloc(32, 0x42).toString('base64');
  const prisma = new FakePrisma();
  const redis = new FakeRedis();
  const svc = new AgentXService(prisma as any, redis as any);
  return { svc, prisma, redis };
}

describe('AgentXService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('assertOwner', () => {
    it('passes when the caller owns an AI_AGENT listing', async () => {
      const { svc, prisma } = makeService();
      prisma.listings.set('L1', { sellerId: 'U1', type: 'AI_AGENT' });
      await expect(svc.assertOwner('L1', 'U1')).resolves.toBeUndefined();
    });
    it('throws NotFound when listing does not exist', async () => {
      const { svc } = makeService();
      await expect(svc.assertOwner('L?', 'U1')).rejects.toBeInstanceOf(NotFoundException);
    });
    it('throws Forbidden when caller does not own the listing', async () => {
      const { svc, prisma } = makeService();
      prisma.listings.set('L1', { sellerId: 'U_OTHER', type: 'AI_AGENT' });
      await expect(svc.assertOwner('L1', 'U1')).rejects.toBeInstanceOf(ForbiddenException);
    });
    it('throws BadRequest when listing is not an AI agent', async () => {
      const { svc, prisma } = makeService();
      prisma.listings.set('L1', { sellerId: 'U1', type: 'REPO' });
      await expect(svc.assertOwner('L1', 'U1')).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('upsertAppCredentials', () => {
    it('rejects empty inputs', async () => {
      const { svc } = makeService();
      await expect(svc.upsertAppCredentials('L1', '', '')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      await expect(svc.upsertAppCredentials('L1', 'cid', '')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
    it('rejects unreasonably long inputs', async () => {
      const { svc } = makeService();
      const huge = 'x'.repeat(201);
      await expect(svc.upsertAppCredentials('L1', huge, 'cs')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
    it('persists encrypted credentials on first save', async () => {
      const { svc, prisma } = makeService();
      // Use a plaintext that's longer than 3 chars to avoid base64
      // accidental-substring matches; we're checking the cipher actually
      // ran, not a vibes-based "looks scrambled" check.
      const plaintextSecret = 'plain-text-secret-marker-9876';
      const res = await svc.upsertAppCredentials('L1', 'plain-id-marker-1234', plaintextSecret);
      expect(res).toEqual({ ok: true, hasOAuth: false });
      const row = prisma.rows.get('L1');
      expect(row.clientIdEnc).toBeDefined();
      expect(row.clientSecretEnc).toBeDefined();
      // Encryption envelope is not the plaintext (cipher util output is
      // <iv>:<ct>:<tag> base64 segments, which won't ever contain a
      // 20+ char dash-delimited marker verbatim).
      expect(row.clientIdEnc).not.toContain('plain-id-marker');
      expect(row.clientSecretEnc).not.toContain('plain-text-secret');
      // Round-trip with the cipher to prove the saved value decrypts back.
      const { decryptToken } = await import('../../common/crypto/token-cipher.util');
      expect(decryptToken(row.clientSecretEnc)).toBe(plaintextSecret);
    });
    it('wipes existing OAuth tokens when credentials are rotated', async () => {
      const { svc, prisma } = makeService();
      // Pre-seed a connection that already completed OAuth.
      prisma.rows.set('L1', {
        id: 'cuid-L1',
        clientIdEnc: 'old',
        clientSecretEnc: 'old',
        accessTokenEnc: 'present',
        refreshTokenEnc: 'present',
        expiresAt: new Date(Date.now() + 60_000),
        xUserId: 'X123',
        screenName: 'old',
        postsLast24h: 5,
        postsWindowStart: new Date(),
      });
      const res = await svc.upsertAppCredentials('L1', 'NEW_CID', 'NEW_CS');
      expect(res.hasOAuth).toBe(true); // signals to FE that prior tokens were wiped
      const row = prisma.rows.get('L1');
      expect(row.accessTokenEnc).toBeNull();
      expect(row.refreshTokenEnc).toBeNull();
      expect(row.expiresAt).toBeNull();
      expect(row.xUserId).toBeNull();
      expect(row.screenName).toBeNull();
      expect(row.postsLast24h).toBe(0);
    });
  });

  describe('generateAuthUrl', () => {
    it('refuses if credentials have not been saved yet', async () => {
      const { svc } = makeService();
      await expect(svc.generateAuthUrl('L1', 'U1', undefined)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
    it('produces a valid X authorize URL using the listing clientId', async () => {
      const { svc, redis } = makeService();
      await svc.upsertAppCredentials('L1', 'CID-XYZ', 'CS');
      const { url } = await svc.generateAuthUrl('L1', 'U1', '/market/agents/L1');
      expect(url).toContain('twitter.com/i/oauth2/authorize');
      expect(url).toContain('client_id=CID-XYZ');
      expect(url).toContain('code_challenge_method=S256');
      // State persisted in Redis under the agent-x namespace.
      expect(redis.set).toHaveBeenCalledWith(
        expect.stringMatching(/^agent-x:oauth:state:/),
        expect.stringContaining('L1'),
        expect.any(Number),
      );
    });
    it('adds force_login + prompt=login when opt is set', async () => {
      const { svc } = makeService();
      await svc.upsertAppCredentials('L1', 'CID', 'CS');
      const { url } = await svc.generateAuthUrl('L1', 'U1', undefined, { forceLogin: true });
      expect(url).toContain('force_login=true');
      expect(url).toContain('prompt=login');
    });
  });

  describe('handleCallback', () => {
    it('rejects missing code or state', async () => {
      const { svc } = makeService();
      await expect(svc.handleCallback('', 'state')).rejects.toBeInstanceOf(BadRequestException);
      await expect(svc.handleCallback('code', '')).rejects.toBeInstanceOf(BadRequestException);
    });
    it('rejects unknown state (expired or never minted)', async () => {
      const { svc } = makeService();
      await expect(svc.handleCallback('code', 'unknown')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });
    it('completes the OAuth dance and persists tokens', async () => {
      const { svc, prisma } = makeService();
      await svc.upsertAppCredentials('L1', 'CID', 'CS');
      const { url } = await svc.generateAuthUrl('L1', 'U1', '/market/agents/L1');
      const state = new URL(url).searchParams.get('state')!;

      // Mock X's token + users/me responses.
      mockedAxios.post.mockResolvedValueOnce({
        data: {
          access_token: 'AT',
          refresh_token: 'RT',
          expires_in: 3600,
          scope: 'tweet.read tweet.write users.read offline.access',
        },
      });
      mockedAxios.get.mockResolvedValueOnce({
        data: { data: { id: '777', username: 'logicdollar' } },
      });

      const result = await svc.handleCallback('AUTH_CODE', state);
      expect(result.listingId).toBe('L1');
      expect(result.screenName).toBe('logicdollar');
      const row = prisma.rows.get('L1');
      expect(row.xUserId).toBe('777');
      expect(row.screenName).toBe('logicdollar');
      expect(row.accessTokenEnc).toBeDefined();
      expect(row.refreshTokenEnc).toBeDefined();
      expect(row.expiresAt).toBeInstanceOf(Date);
      expect(row.postsLast24h).toBe(0);
    });
  });

  describe('getStatus', () => {
    it('reports not configured when no row exists', async () => {
      const { svc } = makeService();
      const s = await svc.getStatus('L?');
      expect(s).toEqual({ configured: false, connected: false, authMethod: null });
    });
    it('reports configured but not connected after only credentials saved', async () => {
      const { svc } = makeService();
      await svc.upsertAppCredentials('L1', 'CID', 'CS');
      const s: any = await svc.getStatus('L1');
      expect(s.configured).toBe(true);
      expect(s.connected).toBe(false);
    });
    it('reports connected with screenName once OAuth done', async () => {
      const { svc, prisma } = makeService();
      await svc.upsertAppCredentials('L1', 'CID', 'CS');
      const row = prisma.rows.get('L1')!;
      row.accessTokenEnc = 'present';
      row.screenName = 'agent_handle';
      row.expiresAt = new Date(Date.now() + 60_000);
      const s: any = await svc.getStatus('L1');
      expect(s.connected).toBe(true);
      expect(s.screenName).toBe('agent_handle');
      expect(s.dailyCap).toBe(50);
    });
  });

  describe('postLaunchTweet', () => {
    const tokenInput = {
      symbol: 'TEST',
      name: 'TestToken',
      tokenAddress: '0xabc',
      url: 'https://example.com/launchpad/0xabc',
      agentName: 'TestAgent',
    };

    it('returns not_configured when no row exists', async () => {
      const { svc } = makeService();
      const r = await svc.postLaunchTweet('L1', tokenInput);
      expect(r).toEqual({ posted: false, reason: 'not_configured' });
    });
    it('returns not_connected when credentials are saved but OAuth never ran', async () => {
      const { svc } = makeService();
      await svc.upsertAppCredentials('L1', 'CID', 'CS');
      const r = await svc.postLaunchTweet('L1', tokenInput);
      expect(r).toEqual({ posted: false, reason: 'not_connected' });
    });
    it('posts and returns the tweet id on the happy path', async () => {
      const { svc, prisma } = makeService();
      // Pre-seed a fully connected row with a fresh access token so we
      // bypass the refresh path.
      const { encryptToken } = await import('../../common/crypto/token-cipher.util');
      prisma.rows.set('L1', {
        id: 'cuid-L1',
        clientIdEnc: encryptToken('CID'),
        clientSecretEnc: encryptToken('CS'),
        accessTokenEnc: encryptToken('AT_FRESH'),
        refreshTokenEnc: encryptToken('RT'),
        expiresAt: new Date(Date.now() + 600_000),
        xUserId: '777',
        screenName: 'logicdollar',
        postsLast24h: 0,
        postsWindowStart: new Date(),
      });
      mockedAxios.post.mockResolvedValueOnce({
        data: { data: { id: 'tweet-123', text: 'Just launched $TEST on haggl' } },
      });
      const r = await svc.postLaunchTweet('L1', tokenInput);
      expect(r.posted).toBe(true);
      if (r.posted) {
        expect(r.id).toBe('tweet-123');
        expect(r.screenName).toBe('logicdollar');
      }
      // Bearer header is the listing's access token.
      const headers = mockedAxios.post.mock.calls[0][2]?.headers as Record<string, string>;
      expect(headers.Authorization).toBe('Bearer AT_FRESH');
    });
    it('surfaces the X 403 message verbatim under reason=failed', async () => {
      const { svc, prisma } = makeService();
      const { encryptToken } = await import('../../common/crypto/token-cipher.util');
      prisma.rows.set('L1', {
        id: 'cuid-L1',
        clientIdEnc: encryptToken('CID'),
        clientSecretEnc: encryptToken('CS'),
        accessTokenEnc: encryptToken('AT'),
        refreshTokenEnc: encryptToken('RT'),
        expiresAt: new Date(Date.now() + 600_000),
        xUserId: '777',
        screenName: 'logicdollar',
        postsLast24h: 0,
        postsWindowStart: new Date(),
      });
      const xError: any = new Error('Request failed with status code 403');
      xError.response = { status: 403, data: { detail: 'duplicate content' } };
      mockedAxios.post.mockRejectedValueOnce(xError);
      const r = await svc.postLaunchTweet('L1', tokenInput);
      expect(r.posted).toBe(false);
      if (!r.posted) {
        expect(r.reason).toBe('failed');
        expect(r.detail).toContain('duplicate content');
        expect(r.detail).toContain('403');
      }
    });
    it('returns reason=cap_reached when the per-listing daily cap is hit', async () => {
      const { svc, prisma } = makeService();
      const { encryptToken } = await import('../../common/crypto/token-cipher.util');
      prisma.rows.set('L1', {
        id: 'cuid-L1',
        clientIdEnc: encryptToken('CID'),
        clientSecretEnc: encryptToken('CS'),
        accessTokenEnc: encryptToken('AT'),
        refreshTokenEnc: encryptToken('RT'),
        expiresAt: new Date(Date.now() + 600_000),
        xUserId: '777',
        screenName: 'logicdollar',
        postsLast24h: 50, // already at cap
        postsWindowStart: new Date(), // window not stale
      });
      const r = await svc.postLaunchTweet('L1', tokenInput);
      expect(r.posted).toBe(false);
      if (!r.posted) {
        expect(r.reason).toBe('cap_reached');
      }
    });
  });

  describe('disconnect', () => {
    it('removes the row', async () => {
      const { svc, prisma } = makeService();
      await svc.upsertAppCredentials('L1', 'CID', 'CS');
      expect(prisma.rows.has('L1')).toBe(true);
      await svc.disconnect('L1');
      expect(prisma.rows.has('L1')).toBe(false);
    });
  });
});
