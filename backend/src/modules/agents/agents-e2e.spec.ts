/* eslint-disable @typescript-eslint/no-explicit-any */
import * as http from 'http';
import { AddressInfo } from 'net';

import { verifyRequest, SIGNATURE_HEADER } from './agents-hmac.util';
import { AgentsTestService } from './agents-test.service';
import { McpAdapter } from './protocols/mcp.adapter';
import { OpenAiAdapter } from './protocols/openai.adapter';
import { WebhookAdapter } from './protocols/webhook.adapter';

// CRITICAL: this test makes real HTTP calls against a local server we
// spin up on each test. We mock the SSRF guard because it (correctly)
// rejects loopback in prod. We're testing the adapter pipeline end to
// end, not the SSRF guard itself.
jest.mock('../../common/sanitize/sanitize.util', () => ({
  isSafeUrlResolving: jest.fn().mockResolvedValue({ ok: true, ip: '127.0.0.1', family: 4 }),
}));

interface MockHandler {
  (req: http.IncomingMessage, body: string): { status: number; body: unknown };
}

function startMockServer(
  handler: MockHandler,
): Promise<{ url: string; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        try {
          const body = Buffer.concat(chunks).toString('utf8');
          const out = handler(req, body);
          res.writeHead(out.status, { 'Content-Type': 'application/json' });
          res.end(typeof out.body === 'string' ? out.body : JSON.stringify(out.body));
        } catch (err) {
          res.writeHead(500);
          res.end(String(err));
        }
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as AddressInfo).port;
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise<void>((r) => server.close(() => r())),
      });
    });
  });
}

function makeService(): AgentsTestService {
  return new AgentsTestService(new WebhookAdapter(), new McpAdapter(), new OpenAiAdapter());
}

describe('agents-e2e (real HTTP)', () => {
  beforeEach(() => {
    process.env.AGENT_HMAC_SECRET = 'e2e-shared-secret';
  });

  it('webhook: end-to-end happy path with HMAC verification on the receiver side', async () => {
    let receivedSig: string | null = null;
    let receivedBody: string | null = null;
    const server = await startMockServer((req, body) => {
      receivedSig = req.headers[SIGNATURE_HEADER] as string;
      receivedBody = body;
      const parsed = JSON.parse(body);
      if (parsed.event === 'health_check') {
        return { status: 200, body: { ok: true } };
      }
      return { status: 200, body: { reply: `you said: ${parsed.prompt}` } };
    });

    try {
      const result = await makeService().test('webhook', { endpoint: server.url }, 'hello e2e');
      expect(result.health.healthy).toBe(true);
      expect(result.invoke?.ok).toBe(true);
      expect(result.invoke?.reply).toBe('you said: hello e2e');

      // The agent on the other side received both the body AND a valid
      // signature it can verify with the same shared secret.
      expect(receivedSig).toMatch(/^t=\d+,v1=[a-f0-9]{64}$/);
      const verify = verifyRequest(receivedBody!, receivedSig!, 'e2e-shared-secret');
      expect(verify.valid).toBe(true);
    } finally {
      await server.close();
    }
  }, 15_000);

  it('webhook: receiver gets a NEW signature for the invoke body (not the health body)', async () => {
    const seen: { event: string; sig: string; body: string }[] = [];
    const server = await startMockServer((req, body) => {
      seen.push({
        event: req.headers['x-bolty-event'] as string,
        sig: req.headers[SIGNATURE_HEADER] as string,
        body,
      });
      const parsed = JSON.parse(body);
      if (parsed.event === 'health_check') return { status: 200, body: { ok: true } };
      return { status: 200, body: { reply: 'ok' } };
    });
    try {
      await makeService().test('webhook', { endpoint: server.url }, 'invoke me');
      expect(seen).toHaveLength(2);
      expect(seen[0].event).toBe('health_check');
      expect(seen[1].event).toBe('invoke');
      expect(seen[0].sig).not.toBe(seen[1].sig);
      // Each signature only validates for its own body — substituting them
      // would be the kind of bug we want a real HTTP test to catch.
      expect(verifyRequest(seen[0].body, seen[0].sig, 'e2e-shared-secret').valid).toBe(true);
      expect(verifyRequest(seen[1].body, seen[1].sig, 'e2e-shared-secret').valid).toBe(true);
      expect(verifyRequest(seen[0].body, seen[1].sig, 'e2e-shared-secret').valid).toBe(false);
    } finally {
      await server.close();
    }
  }, 15_000);

  it('mcp: end-to-end JSON-RPC handshake + tools/call', async () => {
    const server = await startMockServer((_req, body) => {
      const rpc = JSON.parse(body);
      if (rpc.method === 'initialize') {
        return {
          status: 200,
          body: {
            jsonrpc: '2.0',
            id: rpc.id,
            result: { protocolVersion: '2024-11-05', capabilities: {} },
          },
        };
      }
      if (rpc.method === 'tools/call' && rpc.params?.name === 'invoke') {
        return {
          status: 200,
          body: {
            jsonrpc: '2.0',
            id: rpc.id,
            result: {
              content: [{ type: 'text', text: `mcp got: ${rpc.params.arguments.prompt}` }],
            },
          },
        };
      }
      return { status: 400, body: { error: 'unknown method' } };
    });
    try {
      const result = await makeService().test('mcp', { endpoint: server.url }, 'mcp hello');
      expect(result.health.healthy).toBe(true);
      expect(result.invoke?.ok).toBe(true);
      expect(result.invoke?.reply).toBe('mcp got: mcp hello');
    } finally {
      await server.close();
    }
  }, 15_000);

  it('openai: end-to-end chat-completion happy path', async () => {
    const server = await startMockServer((req, body) => {
      const auth = req.headers.authorization;
      if (auth !== 'Bearer sk-test-e2e') {
        return { status: 401, body: { error: { message: 'unauthorized' } } };
      }
      const parsed = JSON.parse(body);
      const userMsg = parsed.messages?.find((m: any) => m.role === 'user')?.content;
      return {
        status: 200,
        body: {
          id: 'cmpl-x',
          choices: [{ index: 0, message: { role: 'assistant', content: `oai got: ${userMsg}` } }],
        },
      };
    });
    try {
      const result = await makeService().test(
        'openai',
        {
          endpoint: `${server.url}/v1/chat/completions`,
          model: 'gpt-4o-mini',
          apiKey: 'sk-test-e2e',
        },
        'hello openai',
      );
      expect(result.health.healthy).toBe(true);
      expect(result.invoke?.ok).toBe(true);
      expect(result.invoke?.reply).toBe('oai got: hello openai');
    } finally {
      await server.close();
    }
  }, 15_000);

  it('openai: bad api key surfaces auth_failed without making an invoke call', async () => {
    let invokeCalls = 0;
    const server = await startMockServer((_req, body) => {
      invokeCalls += JSON.parse(body).max_tokens === 1 ? 0 : 1;
      return { status: 401, body: { error: { message: 'invalid api key' } } };
    });
    try {
      const result = await makeService().test('openai', {
        endpoint: `${server.url}/v1/chat/completions`,
        model: 'gpt-4o-mini',
        apiKey: 'wrong',
      });
      expect(result.health.healthy).toBe(false);
      expect(result.health.reason).toBe('auth_failed');
      // No invoke after failed health → invokeCalls stays 0.
      expect(invokeCalls).toBe(0);
      expect(result.invoke).toBeUndefined();
    } finally {
      await server.close();
    }
  }, 15_000);

  it('webhook: 5xx from the agent is reported as unhealthy (no invoke fired)', async () => {
    let calls = 0;
    const server = await startMockServer((_req, _body) => {
      calls += 1;
      return { status: 500, body: { err: 'boom' } };
    });
    try {
      const result = await makeService().test('webhook', { endpoint: server.url });
      expect(result.health.healthy).toBe(false);
      expect(result.health.reason).toBe('http_500');
      expect(result.invoke).toBeUndefined();
      // Only the health-check call hit the server; invoke was skipped.
      expect(calls).toBe(1);
    } finally {
      await server.close();
    }
  }, 15_000);
});
