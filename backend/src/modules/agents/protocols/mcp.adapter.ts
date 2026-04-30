import { Injectable, Logger } from '@nestjs/common';
import axios, { AxiosError } from 'axios';

import { isSafeUrlResolving } from '../../../common/sanitize/sanitize.util';
import { signRequest } from '../agents-hmac.util';

import {
  AgentEndpointConfig,
  AgentHealthResult,
  AgentInvokeInput,
  AgentInvokeOutput,
  IProtocolAdapter,
  ProtocolKind,
} from './protocol-adapter.interface';

/**
 * MCP (Model Context Protocol) HTTP adapter.
 *
 * The MCP server speaks JSON-RPC 2.0 over plain HTTP. We hit two
 * methods:
 *
 *   - `initialize` for the health check (lightweight handshake every
 *     conformant MCP server answers).
 *   - `prompts/get` (or `tools/call` if a `haggl_invoke` tool is
 *     declared) for the invoke path. To keep v1 surgical we map a
 *     buyer prompt onto the tool call `{ name: 'invoke', arguments:
 *     { prompt } }` — sellers wire that up server-side.
 *
 * MCP responses look like:
 *   { jsonrpc: '2.0', id: …, result: { content: [{ type:'text', text }] } }
 * We pull the first text content out and surface it as `reply`.
 *
 * Spec ref: https://modelcontextprotocol.io/specification — kept
 * conservative against the 2024-11-05 revision.
 */
@Injectable()
export class McpAdapter implements IProtocolAdapter {
  readonly kind: ProtocolKind = 'mcp';

  private readonly logger = new Logger(McpAdapter.name);
  private static readonly HEALTH_TIMEOUT_MS = 6000;
  private static readonly INVOKE_TIMEOUT_MS = 20_000;
  private static readonly MAX_RESPONSE_BYTES = 512 * 1024;
  private static readonly PROTOCOL_VERSION = '2024-11-05';

  validateConfig(config: AgentEndpointConfig): string | null {
    if (!config?.endpoint) return 'MCP server URL is required';
    let parsed: URL;
    try {
      parsed = new URL(config.endpoint);
    } catch {
      return 'MCP server URL is not a valid URL';
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return 'MCP server URL must be http(s)';
    }
    if (config.endpoint.length > 500) return 'MCP server URL is too long';
    return null;
  }

  async healthCheck(config: AgentEndpointConfig): Promise<AgentHealthResult> {
    const reason = this.validateConfig(config);
    if (reason) return { healthy: false, latencyMs: 0, reason };

    const safe = await isSafeUrlResolving(config.endpoint);
    if (!safe.ok) {
      return { healthy: false, latencyMs: 0, reason: `unsafe_url: ${safe.reason}` };
    }

    const body = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: McpAdapter.PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: 'haggl', version: '1.0' },
      },
    });

    const start = Date.now();
    try {
      const res = await axios.post(config.endpoint, body, {
        headers: this.buildHeaders(body, 'health_check'),
        timeout: McpAdapter.HEALTH_TIMEOUT_MS,
        maxRedirects: 0,
        maxBodyLength: McpAdapter.MAX_RESPONSE_BYTES,
        maxContentLength: McpAdapter.MAX_RESPONSE_BYTES,
        validateStatus: () => true,
      });
      const latencyMs = Date.now() - start;

      // MCP servers MUST answer initialize with a JSON-RPC 2.0
      // response. Anything else (HTML error pages, plain text, 5xx)
      // is "down" from our perspective.
      if (res.status >= 500) {
        return { healthy: false, latencyMs, status: res.status, reason: `http_${res.status}` };
      }
      if (!res.data || res.data.jsonrpc !== '2.0') {
        return {
          healthy: false,
          latencyMs,
          status: res.status,
          reason: 'not_jsonrpc_2_0',
        };
      }
      if (res.data.error) {
        return {
          healthy: false,
          latencyMs,
          status: res.status,
          reason: `mcp_error: ${res.data.error.message ?? res.data.error.code}`,
        };
      }
      return { healthy: true, latencyMs, status: res.status };
    } catch (err) {
      return {
        healthy: false,
        latencyMs: Date.now() - start,
        reason: this.summarize(err),
      };
    }
  }

  async invoke(config: AgentEndpointConfig, input: AgentInvokeInput): Promise<AgentInvokeOutput> {
    const reason = this.validateConfig(config);
    if (reason) return { reply: '', latencyMs: 0, raw: { error: reason } };
    const safe = await isSafeUrlResolving(config.endpoint);
    if (!safe.ok) {
      return { reply: '', latencyMs: 0, raw: { error: `unsafe_url: ${safe.reason}` } };
    }

    const body = JSON.stringify({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: {
        name: 'invoke',
        arguments: {
          prompt: input.prompt,
          conversationId: input.conversationId ?? null,
          history: input.history ?? [],
        },
      },
    });

    const start = Date.now();
    try {
      const res = await axios.post(config.endpoint, body, {
        headers: this.buildHeaders(body, 'invoke'),
        timeout: McpAdapter.INVOKE_TIMEOUT_MS,
        maxRedirects: 0,
        maxBodyLength: McpAdapter.MAX_RESPONSE_BYTES,
        maxContentLength: McpAdapter.MAX_RESPONSE_BYTES,
        validateStatus: () => true,
      });
      const latencyMs = Date.now() - start;

      if (res.status >= 400) {
        return { reply: '', latencyMs, raw: { status: res.status, body: res.data } };
      }
      const data = res.data ?? {};
      if (data.error) {
        return {
          reply: '',
          latencyMs,
          raw: { error: data.error?.message ?? 'mcp_error', code: data.error?.code },
        };
      }
      const content = Array.isArray(data?.result?.content) ? data.result.content : [];
      const firstText = content.find(
        (c: { type?: string; text?: string }) => c?.type === 'text' && typeof c.text === 'string',
      );
      const reply = firstText?.text ?? '';
      return { reply, latencyMs, raw: data };
    } catch (err) {
      return {
        reply: '',
        latencyMs: Date.now() - start,
        raw: { error: this.summarize(err) },
      };
    }
  }

  private buildHeaders(body: string, event: 'health_check' | 'invoke'): Record<string, string> {
    const secret = process.env.AGENT_HMAC_SECRET ?? '';
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'X-Haggl-Event': event,
      'User-Agent': 'HagglMcpClient/1.0',
    };
    if (secret) {
      Object.assign(headers, signRequest(body, secret));
    }
    return headers;
  }

  private summarize(err: unknown): string {
    if (err instanceof AxiosError) {
      if (err.code === 'ECONNABORTED') return 'timeout';
      if (err.code === 'ENOTFOUND') return 'dns_not_found';
      if (err.code === 'ECONNREFUSED') return 'connection_refused';
      return err.code ?? err.message ?? 'request_failed';
    }
    return err instanceof Error ? err.message : 'unknown';
  }
}
