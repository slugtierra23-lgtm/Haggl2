/* eslint-disable @typescript-eslint/no-explicit-any */
import axios from 'axios';

import { WebhookAdapter } from './webhook.adapter';

jest.mock('axios');
jest.mock('../../../common/sanitize/sanitize.util', () => ({
  isSafeUrlResolving: jest.fn().mockResolvedValue({ ok: true, ip: '203.0.113.1', family: 4 }),
}));

const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('WebhookAdapter', () => {
  let adapter: WebhookAdapter;

  beforeEach(() => {
    process.env.AGENT_HMAC_SECRET = 'test-secret';
    adapter = new WebhookAdapter();
    jest.clearAllMocks();
  });

  describe('validateConfig', () => {
    it('rejects missing endpoint', () => {
      expect(adapter.validateConfig({ endpoint: '' })).toMatch(/required/);
    });
    it('rejects malformed URLs', () => {
      expect(adapter.validateConfig({ endpoint: 'not a url' })).toMatch(/valid URL/);
    });
    it('rejects non-http(s) protocols', () => {
      expect(adapter.validateConfig({ endpoint: 'ftp://example.com' })).toMatch(/http/);
    });
    it('rejects URLs over 500 chars', () => {
      const huge = 'https://example.com/' + 'a'.repeat(500);
      expect(adapter.validateConfig({ endpoint: huge })).toMatch(/too long/);
    });
    it('accepts a valid https URL', () => {
      expect(adapter.validateConfig({ endpoint: 'https://api.example.com/haggl' })).toBeNull();
    });
  });

  describe('healthCheck', () => {
    it('returns healthy on a 2xx response', async () => {
      mockedAxios.post.mockResolvedValueOnce({ status: 200, data: { ok: true } });
      const res = await adapter.healthCheck({ endpoint: 'https://api.example.com/haggl' });
      expect(res.healthy).toBe(true);
      expect(res.status).toBe(200);
      expect(res.latencyMs).toBeGreaterThanOrEqual(0);
    });

    it('returns healthy on a 4xx response (agent answered, refused payload)', async () => {
      mockedAxios.post.mockResolvedValueOnce({ status: 401, data: { error: 'unauthorized' } });
      const res = await adapter.healthCheck({ endpoint: 'https://api.example.com/haggl' });
      expect(res.healthy).toBe(true);
      expect(res.status).toBe(401);
    });

    it('returns unhealthy on a 5xx response', async () => {
      mockedAxios.post.mockResolvedValueOnce({ status: 503, data: '' });
      const res = await adapter.healthCheck({ endpoint: 'https://api.example.com/haggl' });
      expect(res.healthy).toBe(false);
      expect(res.status).toBe(503);
      expect(res.reason).toBe('http_503');
    });

    it('returns unhealthy on a network error', async () => {
      mockedAxios.post.mockRejectedValueOnce(new Error('ECONNRESET'));
      const res = await adapter.healthCheck({ endpoint: 'https://api.example.com/haggl' });
      expect(res.healthy).toBe(false);
      expect(res.reason).toBeDefined();
    });

    it('signs the outbound payload with HMAC when secret is set', async () => {
      mockedAxios.post.mockResolvedValueOnce({ status: 200, data: {} });
      await adapter.healthCheck({ endpoint: 'https://api.example.com/haggl' });
      expect(mockedAxios.post).toHaveBeenCalledTimes(1);
      const headers = mockedAxios.post.mock.calls[0][2]?.headers as Record<string, string>;
      expect(headers['X-Haggl-Event']).toBe('health_check');
      expect(headers['x-haggl-signature']).toMatch(/^t=\d+,v1=[a-f0-9]{64}$/);
    });

    it('omits the signature header when secret is missing', async () => {
      delete process.env.AGENT_HMAC_SECRET;
      mockedAxios.post.mockResolvedValueOnce({ status: 200, data: {} });
      await adapter.healthCheck({ endpoint: 'https://api.example.com/haggl' });
      const headers = mockedAxios.post.mock.calls[0][2]?.headers as Record<string, string>;
      expect(headers['x-haggl-signature']).toBeUndefined();
    });

    it('refuses to call the endpoint if validateConfig fails', async () => {
      const res = await adapter.healthCheck({ endpoint: 'ftp://example.com' });
      expect(res.healthy).toBe(false);
      expect(mockedAxios.post).not.toHaveBeenCalled();
    });
  });

  describe('invoke', () => {
    it('returns the parsed reply on a 200 with valid body', async () => {
      mockedAxios.post.mockResolvedValueOnce({
        status: 200,
        data: { reply: 'hello back', action: { type: 'noop' } },
      });
      const res = await adapter.invoke(
        { endpoint: 'https://api.example.com/haggl' },
        { prompt: 'hi' },
      );
      expect(res.reply).toBe('hello back');
      expect(res.action).toEqual({ type: 'noop' });
      expect(res.latencyMs).toBeGreaterThanOrEqual(0);
    });

    it('returns empty reply when the body shape is wrong', async () => {
      mockedAxios.post.mockResolvedValueOnce({
        status: 200,
        data: { somethingElse: 'oops' },
      });
      const res = await adapter.invoke(
        { endpoint: 'https://api.example.com/haggl' },
        { prompt: 'hi' },
      );
      expect(res.reply).toBe('');
      expect(res.action).toBeNull();
    });

    it('returns empty reply on 4xx/5xx with raw status', async () => {
      mockedAxios.post.mockResolvedValueOnce({ status: 500, data: { error: 'boom' } });
      const res = await adapter.invoke(
        { endpoint: 'https://api.example.com/haggl' },
        { prompt: 'hi' },
      );
      expect(res.reply).toBe('');
      expect((res.raw as any).status).toBe(500);
    });

    it('forwards conversationId + history in the body', async () => {
      mockedAxios.post.mockResolvedValueOnce({ status: 200, data: { reply: 'ok' } });
      await adapter.invoke(
        { endpoint: 'https://api.example.com/haggl' },
        {
          prompt: 'second turn',
          conversationId: 'abc-123',
          history: [
            { role: 'user', content: 'first' },
            { role: 'assistant', content: 'reply 1' },
          ],
        },
      );
      const body = JSON.parse(mockedAxios.post.mock.calls[0][1] as string);
      expect(body.event).toBe('invoke');
      expect(body.prompt).toBe('second turn');
      expect(body.conversationId).toBe('abc-123');
      expect(body.history).toHaveLength(2);
    });

    it('handles network errors without throwing', async () => {
      mockedAxios.post.mockRejectedValueOnce(new Error('socket hang up'));
      const res = await adapter.invoke(
        { endpoint: 'https://api.example.com/haggl' },
        { prompt: 'hi' },
      );
      expect(res.reply).toBe('');
      expect(res.raw).toMatchObject({ error: expect.any(String) });
    });
  });
});
