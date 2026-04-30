/* eslint-disable @typescript-eslint/no-explicit-any */
import axios from 'axios';

import { McpAdapter } from './mcp.adapter';

jest.mock('axios');
jest.mock('../../../common/sanitize/sanitize.util', () => ({
  isSafeUrlResolving: jest.fn().mockResolvedValue({ ok: true, ip: '203.0.113.1', family: 4 }),
}));

const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('McpAdapter', () => {
  let adapter: McpAdapter;

  beforeEach(() => {
    process.env.AGENT_HMAC_SECRET = 'test-secret';
    adapter = new McpAdapter();
    jest.clearAllMocks();
  });

  describe('validateConfig', () => {
    it('rejects missing endpoint', () => {
      expect(adapter.validateConfig({ endpoint: '' })).toMatch(/required/);
    });
    it('rejects malformed URL', () => {
      expect(adapter.validateConfig({ endpoint: 'not-a-url' })).toMatch(/valid URL/);
    });
    it('accepts a valid https URL', () => {
      expect(adapter.validateConfig({ endpoint: 'https://mcp.example.com' })).toBeNull();
    });
  });

  describe('healthCheck', () => {
    it('returns healthy when initialize returns a valid JSON-RPC response', async () => {
      mockedAxios.post.mockResolvedValueOnce({
        status: 200,
        data: {
          jsonrpc: '2.0',
          id: 1,
          result: { capabilities: {}, protocolVersion: '2024-11-05' },
        },
      });
      const res = await adapter.healthCheck({ endpoint: 'https://mcp.example.com' });
      expect(res.healthy).toBe(true);
      expect(res.status).toBe(200);
    });

    it('rejects responses missing jsonrpc field', async () => {
      mockedAxios.post.mockResolvedValueOnce({
        status: 200,
        data: { something: 'else' },
      });
      const res = await adapter.healthCheck({ endpoint: 'https://mcp.example.com' });
      expect(res.healthy).toBe(false);
      expect(res.reason).toBe('not_jsonrpc_2_0');
    });

    it('rejects HTML error pages with 200 status', async () => {
      mockedAxios.post.mockResolvedValueOnce({
        status: 200,
        data: '<html>oops</html>',
      });
      const res = await adapter.healthCheck({ endpoint: 'https://mcp.example.com' });
      expect(res.healthy).toBe(false);
      expect(res.reason).toBe('not_jsonrpc_2_0');
    });

    it('rejects when MCP returns an error object', async () => {
      mockedAxios.post.mockResolvedValueOnce({
        status: 200,
        data: { jsonrpc: '2.0', id: 1, error: { code: -32601, message: 'method not found' } },
      });
      const res = await adapter.healthCheck({ endpoint: 'https://mcp.example.com' });
      expect(res.healthy).toBe(false);
      expect(res.reason).toMatch(/method not found/);
    });

    it('returns unhealthy on 5xx', async () => {
      mockedAxios.post.mockResolvedValueOnce({ status: 502, data: '' });
      const res = await adapter.healthCheck({ endpoint: 'https://mcp.example.com' });
      expect(res.healthy).toBe(false);
      expect(res.status).toBe(502);
    });

    it('sends a JSON-RPC initialize body with the configured protocol version', async () => {
      mockedAxios.post.mockResolvedValueOnce({
        status: 200,
        data: { jsonrpc: '2.0', id: 1, result: {} },
      });
      await adapter.healthCheck({ endpoint: 'https://mcp.example.com' });
      const body = JSON.parse(mockedAxios.post.mock.calls[0][1] as string);
      expect(body.jsonrpc).toBe('2.0');
      expect(body.method).toBe('initialize');
      expect(body.params.protocolVersion).toBe('2024-11-05');
      expect(body.params.clientInfo.name).toBe('haggl');
    });
  });

  describe('invoke', () => {
    it('extracts the first text content from the result', async () => {
      mockedAxios.post.mockResolvedValueOnce({
        status: 200,
        data: {
          jsonrpc: '2.0',
          id: 2,
          result: {
            content: [
              { type: 'text', text: 'hello from mcp' },
              { type: 'image', data: '…' },
            ],
          },
        },
      });
      const res = await adapter.invoke({ endpoint: 'https://mcp.example.com' }, { prompt: 'hi' });
      expect(res.reply).toBe('hello from mcp');
      expect(res.latencyMs).toBeGreaterThanOrEqual(0);
    });

    it('returns empty reply when no text content is present', async () => {
      mockedAxios.post.mockResolvedValueOnce({
        status: 200,
        data: { jsonrpc: '2.0', id: 2, result: { content: [] } },
      });
      const res = await adapter.invoke({ endpoint: 'https://mcp.example.com' }, { prompt: 'hi' });
      expect(res.reply).toBe('');
    });

    it('surfaces JSON-RPC error objects with code', async () => {
      mockedAxios.post.mockResolvedValueOnce({
        status: 200,
        data: {
          jsonrpc: '2.0',
          id: 2,
          error: { code: -32602, message: 'invalid arguments' },
        },
      });
      const res = await adapter.invoke({ endpoint: 'https://mcp.example.com' }, { prompt: 'hi' });
      expect(res.reply).toBe('');
      expect((res.raw as any).error).toMatch(/invalid arguments/);
      expect((res.raw as any).code).toBe(-32602);
    });

    it('forwards prompt + history under tools/call arguments', async () => {
      mockedAxios.post.mockResolvedValueOnce({
        status: 200,
        data: {
          jsonrpc: '2.0',
          id: 2,
          result: { content: [{ type: 'text', text: 'ok' }] },
        },
      });
      await adapter.invoke(
        { endpoint: 'https://mcp.example.com' },
        {
          prompt: 'follow-up',
          conversationId: 'c1',
          history: [{ role: 'user', content: 'first' }],
        },
      );
      const body = JSON.parse(mockedAxios.post.mock.calls[0][1] as string);
      expect(body.method).toBe('tools/call');
      expect(body.params.name).toBe('invoke');
      expect(body.params.arguments.prompt).toBe('follow-up');
      expect(body.params.arguments.conversationId).toBe('c1');
      expect(body.params.arguments.history).toEqual([{ role: 'user', content: 'first' }]);
    });

    it('handles network errors without throwing', async () => {
      mockedAxios.post.mockRejectedValueOnce(new Error('ETIMEDOUT'));
      const res = await adapter.invoke({ endpoint: 'https://mcp.example.com' }, { prompt: 'hi' });
      expect(res.reply).toBe('');
      expect((res.raw as any).error).toBeDefined();
    });

    it('signs the body with HMAC when secret is set', async () => {
      mockedAxios.post.mockResolvedValueOnce({
        status: 200,
        data: { jsonrpc: '2.0', id: 2, result: { content: [{ type: 'text', text: 'ok' }] } },
      });
      await adapter.invoke({ endpoint: 'https://mcp.example.com' }, { prompt: 'hi' });
      const headers = mockedAxios.post.mock.calls[0][2]?.headers as Record<string, string>;
      expect(headers['X-Haggl-Event']).toBe('invoke');
      expect(headers['x-haggl-signature']).toMatch(/^t=\d+,v1=[a-f0-9]{64}$/);
    });
  });
});
