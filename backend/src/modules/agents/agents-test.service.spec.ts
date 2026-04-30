/* eslint-disable @typescript-eslint/no-explicit-any */
import { AgentsTestService } from './agents-test.service';
import {
  AgentEndpointConfig,
  AgentHealthResult,
  AgentInvokeOutput,
  IProtocolAdapter,
  ProtocolKind,
} from './protocols/protocol-adapter.interface';

class FakeAdapter implements IProtocolAdapter {
  constructor(
    public readonly kind: ProtocolKind,
    public readonly behavior: {
      validate?: string | null;
      health?: AgentHealthResult;
      invoke?: AgentInvokeOutput;
      throwOnInvoke?: boolean;
    } = {},
  ) {}

  validateConfig(_config: AgentEndpointConfig): string | null {
    return this.behavior.validate ?? null;
  }
  async healthCheck(_config: AgentEndpointConfig): Promise<AgentHealthResult> {
    return this.behavior.health ?? { healthy: true, latencyMs: 12 };
  }
  async invoke(_config: AgentEndpointConfig): Promise<AgentInvokeOutput> {
    if (this.behavior.throwOnInvoke) throw new Error('boom');
    return this.behavior.invoke ?? { reply: 'ok', latencyMs: 30 };
  }
}

function svc(
  webhookBehavior?: ConstructorParameters<typeof FakeAdapter>[1],
  mcpBehavior?: ConstructorParameters<typeof FakeAdapter>[1],
  openaiBehavior?: ConstructorParameters<typeof FakeAdapter>[1],
): AgentsTestService {
  return new AgentsTestService(
    new FakeAdapter('webhook', webhookBehavior) as any,
    new FakeAdapter('mcp', mcpBehavior) as any,
    new FakeAdapter('openai', openaiBehavior) as any,
  );
}

describe('AgentsTestService', () => {
  describe('validate', () => {
    it('returns ok for a valid config', () => {
      expect(svc().validate('webhook', { endpoint: 'https://x.y' })).toEqual({ ok: true });
    });
    it('returns the adapter validation reason', () => {
      const s = svc({ validate: 'no good' });
      expect(s.validate('webhook', { endpoint: 'https://x.y' })).toEqual({
        ok: false,
        reason: 'no good',
      });
    });
    it('rejects unknown protocol', () => {
      const result = svc().validate('docker' as ProtocolKind, { endpoint: 'x' });
      expect(result.ok).toBe(false);
      expect(result.reason).toMatch(/unknown_protocol/);
    });
  });

  describe('test (full network probe)', () => {
    it('runs health + invoke when both succeed', async () => {
      const s = svc({
        health: { healthy: true, latencyMs: 50 },
        invoke: { reply: 'pong', latencyMs: 75 },
      });
      const result = await s.test('webhook', { endpoint: 'https://x.y' });
      expect(result.protocol).toBe('webhook');
      expect(result.health.healthy).toBe(true);
      expect(result.invoke?.ok).toBe(true);
      expect(result.invoke?.reply).toBe('pong');
      expect(result.invoke?.schemaValid).toBe(true);
    });

    it('skips invoke when health fails', async () => {
      const s = svc({ health: { healthy: false, latencyMs: 50, reason: 'http_503' } });
      const result = await s.test('webhook', { endpoint: 'https://x.y' });
      expect(result.health.healthy).toBe(false);
      expect(result.invoke).toBeUndefined();
    });

    it('reports schema-invalid when invoke returns empty reply', async () => {
      const s = svc({
        health: { healthy: true, latencyMs: 5 },
        invoke: { reply: '', latencyMs: 10, raw: { error: 'empty' } },
      });
      const result = await s.test('webhook', { endpoint: 'https://x.y' });
      expect(result.invoke?.ok).toBe(false);
      expect(result.invoke?.schemaValid).toBe(false);
      expect(result.invoke?.error).toBe('empty');
    });

    it('truncates very long replies to 500 chars', async () => {
      const s = svc({
        health: { healthy: true, latencyMs: 5 },
        invoke: { reply: 'a'.repeat(2000), latencyMs: 10 },
      });
      const result = await s.test('webhook', { endpoint: 'https://x.y' });
      expect(result.invoke?.reply?.length).toBe(500);
    });

    it('returns the adapter validation reason without making network calls', async () => {
      const s = svc({ validate: 'bad url' });
      const result = await s.test('webhook', { endpoint: 'ftp://nope' });
      expect(result.health.healthy).toBe(false);
      expect(result.health.reason).toBe('bad url');
      expect(result.invoke).toBeUndefined();
    });

    it('catches adapter throws on invoke and reports them', async () => {
      const s = svc({ health: { healthy: true, latencyMs: 5 }, throwOnInvoke: true });
      const result = await s.test('webhook', { endpoint: 'https://x.y' });
      expect(result.invoke?.ok).toBe(false);
      expect(result.invoke?.error).toBe('boom');
    });

    it('rejects unknown protocol with structured error', async () => {
      const result = await svc().test('docker' as ProtocolKind, { endpoint: 'x' });
      expect(result.health.healthy).toBe(false);
      expect(result.health.reason).toMatch(/unknown_protocol/);
    });

    it('routes by protocol — mcp goes to mcp adapter', async () => {
      const s = svc(
        { invoke: { reply: 'webhook', latencyMs: 1 } },
        { invoke: { reply: 'mcp', latencyMs: 1 } },
        { invoke: { reply: 'openai', latencyMs: 1 } },
      );
      const wh = await s.test('webhook', { endpoint: 'https://x.y' });
      const mcp = await s.test('mcp', { endpoint: 'https://x.y' });
      const oa = await s.test('openai', { endpoint: 'https://x.y' });
      expect(wh.invoke?.reply).toBe('webhook');
      expect(mcp.invoke?.reply).toBe('mcp');
      expect(oa.invoke?.reply).toBe('openai');
    });
  });

  describe('describeInvokeFailure (via invoke result)', () => {
    it('extracts string error from raw', async () => {
      const s = svc({
        health: { healthy: true, latencyMs: 1 },
        invoke: { reply: '', latencyMs: 1, raw: { error: 'rate limited' } },
      });
      const r = await s.test('webhook', { endpoint: 'https://x.y' });
      expect(r.invoke?.error).toBe('rate limited');
    });

    it('extracts object error message', async () => {
      const s = svc({
        health: { healthy: true, latencyMs: 1 },
        invoke: {
          reply: '',
          latencyMs: 1,
          raw: { error: { message: 'context too long', code: -32000 } },
        },
      });
      const r = await s.test('webhook', { endpoint: 'https://x.y' });
      expect(r.invoke?.error).toBe('context too long');
    });

    it('falls back to http_<status> when only status is in raw', async () => {
      const s = svc({
        health: { healthy: true, latencyMs: 1 },
        invoke: { reply: '', latencyMs: 1, raw: { status: 502 } },
      });
      const r = await s.test('webhook', { endpoint: 'https://x.y' });
      expect(r.invoke?.error).toBe('http_502');
    });

    it('falls back to no_reply_field when raw is empty', async () => {
      const s = svc({
        health: { healthy: true, latencyMs: 1 },
        invoke: { reply: '', latencyMs: 1 },
      });
      const r = await s.test('webhook', { endpoint: 'https://x.y' });
      expect(r.invoke?.error).toBe('no_reply_field');
    });
  });
});
