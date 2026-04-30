/* eslint-disable @typescript-eslint/no-explicit-any */
import axios from 'axios';

import { OpenAiAdapter } from './openai.adapter';

jest.mock('axios');
jest.mock('../../../common/sanitize/sanitize.util', () => ({
  isSafeUrlResolving: jest.fn().mockResolvedValue({ ok: true, ip: '203.0.113.1', family: 4 }),
}));

const mockedAxios = axios as jest.Mocked<typeof axios>;

const goodConfig = {
  endpoint: 'https://api.openai.com/v1/chat/completions',
  model: 'gpt-4o-mini',
  apiKey: 'sk-test',
};

describe('OpenAiAdapter', () => {
  let adapter: OpenAiAdapter;

  beforeEach(() => {
    adapter = new OpenAiAdapter();
    jest.clearAllMocks();
  });

  describe('validateConfig', () => {
    it('rejects missing endpoint', () => {
      expect(adapter.validateConfig({ endpoint: '', model: 'x' })).toMatch(/endpoint is required/);
    });
    it('rejects malformed URL', () => {
      expect(adapter.validateConfig({ endpoint: 'not a url', model: 'x' })).toMatch(/valid URL/);
    });
    it('rejects missing model', () => {
      expect(adapter.validateConfig({ endpoint: 'https://x.com/v1/chat/completions' })).toMatch(
        /Model id/,
      );
    });
    it('rejects model id over 80 chars', () => {
      expect(
        adapter.validateConfig({
          endpoint: 'https://x.com/v1/chat/completions',
          model: 'a'.repeat(81),
        }),
      ).toMatch(/too long/);
    });
    it('accepts a valid config without apiKey (e.g. local llama)', () => {
      expect(
        adapter.validateConfig({
          endpoint: 'http://localhost:8080/v1/chat/completions',
          model: 'llama-3',
        }),
      ).toBeNull();
    });
  });

  describe('healthCheck', () => {
    it('returns healthy on a 2xx with at least one choice', async () => {
      mockedAxios.post.mockResolvedValueOnce({
        status: 200,
        data: {
          id: 'cmpl-1',
          choices: [{ index: 0, message: { role: 'assistant', content: 'pong' } }],
        },
      });
      const res = await adapter.healthCheck(goodConfig);
      expect(res.healthy).toBe(true);
      expect(res.status).toBe(200);
    });

    it('returns unhealthy on 401 with auth_failed reason', async () => {
      mockedAxios.post.mockResolvedValueOnce({
        status: 401,
        data: { error: { message: 'invalid api key' } },
      });
      const res = await adapter.healthCheck(goodConfig);
      expect(res.healthy).toBe(false);
      expect(res.reason).toBe('auth_failed');
    });

    it('returns unhealthy on 404 with endpoint_or_model_missing', async () => {
      mockedAxios.post.mockResolvedValueOnce({
        status: 404,
        data: { error: { message: 'model not found' } },
      });
      const res = await adapter.healthCheck(goodConfig);
      expect(res.healthy).toBe(false);
      expect(res.reason).toBe('endpoint_or_model_missing');
    });

    it('surfaces the upstream error message on a 4xx that is not auth/404', async () => {
      mockedAxios.post.mockResolvedValueOnce({
        status: 400,
        data: { error: { message: 'context length exceeded' } },
      });
      const res = await adapter.healthCheck(goodConfig);
      expect(res.healthy).toBe(false);
      expect(res.reason).toMatch(/context length exceeded/);
    });

    it('returns unhealthy when 200 has no choices array', async () => {
      mockedAxios.post.mockResolvedValueOnce({ status: 200, data: { id: 'x' } });
      const res = await adapter.healthCheck(goodConfig);
      expect(res.healthy).toBe(false);
      expect(res.reason).toBe('no_choices');
    });

    it('returns unhealthy on 5xx', async () => {
      mockedAxios.post.mockResolvedValueOnce({ status: 503, data: '' });
      const res = await adapter.healthCheck(goodConfig);
      expect(res.healthy).toBe(false);
      expect(res.reason).toBe('http_503');
    });

    it('forwards Authorization: Bearer when apiKey set', async () => {
      mockedAxios.post.mockResolvedValueOnce({
        status: 200,
        data: { choices: [{ message: { content: 'ok' } }] },
      });
      await adapter.healthCheck(goodConfig);
      const headers = mockedAxios.post.mock.calls[0][2]?.headers as Record<string, string>;
      expect(headers.Authorization).toBe('Bearer sk-test');
    });

    it('omits Authorization header when apiKey not set', async () => {
      mockedAxios.post.mockResolvedValueOnce({
        status: 200,
        data: { choices: [{ message: { content: 'ok' } }] },
      });
      await adapter.healthCheck({
        endpoint: 'http://localhost:8080/v1/chat/completions',
        model: 'llama',
      });
      const headers = mockedAxios.post.mock.calls[0][2]?.headers as Record<string, string>;
      expect(headers.Authorization).toBeUndefined();
    });

    it('uses max_tokens=1 to keep the probe cheap', async () => {
      mockedAxios.post.mockResolvedValueOnce({
        status: 200,
        data: { choices: [{ message: { content: 'ok' } }] },
      });
      await adapter.healthCheck(goodConfig);
      const body = JSON.parse(mockedAxios.post.mock.calls[0][1] as string);
      expect(body.max_tokens).toBe(1);
      expect(body.model).toBe('gpt-4o-mini');
    });
  });

  describe('invoke', () => {
    it('returns the assistant message content on a 2xx', async () => {
      mockedAxios.post.mockResolvedValueOnce({
        status: 200,
        data: {
          choices: [{ message: { role: 'assistant', content: 'real reply' } }],
          usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
        },
      });
      const res = await adapter.invoke(goodConfig, { prompt: 'hi' });
      expect(res.reply).toBe('real reply');
      expect((res.raw as any).usage.total_tokens).toBe(8);
    });

    it('preserves history order and adds the new user message at the end', async () => {
      mockedAxios.post.mockResolvedValueOnce({
        status: 200,
        data: { choices: [{ message: { content: 'ok' } }] },
      });
      await adapter.invoke(goodConfig, {
        prompt: 'third',
        history: [
          { role: 'user', content: 'first' },
          { role: 'assistant', content: 'second' },
        ],
      });
      const body = JSON.parse(mockedAxios.post.mock.calls[0][1] as string);
      expect(body.messages).toEqual([
        { role: 'user', content: 'first' },
        { role: 'assistant', content: 'second' },
        { role: 'user', content: 'third' },
      ]);
    });

    it('returns empty reply when 4xx', async () => {
      mockedAxios.post.mockResolvedValueOnce({
        status: 429,
        data: { error: { message: 'rate limited' } },
      });
      const res = await adapter.invoke(goodConfig, { prompt: 'hi' });
      expect(res.reply).toBe('');
      expect((res.raw as any).status).toBe(429);
    });

    it('returns empty reply when message.content is missing', async () => {
      mockedAxios.post.mockResolvedValueOnce({
        status: 200,
        data: { choices: [{ message: { role: 'assistant' } }] },
      });
      const res = await adapter.invoke(goodConfig, { prompt: 'hi' });
      expect(res.reply).toBe('');
    });

    it('handles network errors without throwing', async () => {
      mockedAxios.post.mockRejectedValueOnce(new Error('socket reset'));
      const res = await adapter.invoke(goodConfig, { prompt: 'hi' });
      expect(res.reply).toBe('');
      expect((res.raw as any).error).toBeDefined();
    });
  });
});
