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
 * haggl Webhook protocol — the simplest contract.
 *
 *   POST <endpoint>
 *   X-Haggl-Event: health_check | invoke
 *   X-Haggl-Signature: t=…,v1=…
 *   Content-Type: application/json
 *
 *   { event, prompt?, conversationId?, history? }
 *
 * Expected response shape:
 *   { reply: string, action?: { type, data? } }
 *
 * Rejects:
 *   - Non-HTTPS endpoints (except for localhost in tests, where
 *     `isSafeUrlResolving` already gates SSRF risk).
 *   - 5xx / network errors / timeouts → reported as health failure.
 *   - 2xx with malformed body → reported as `schemaValid: false`.
 */
@Injectable()
export class WebhookAdapter implements IProtocolAdapter {
  readonly kind: ProtocolKind = 'webhook';

  private readonly logger = new Logger(WebhookAdapter.name);
  private static readonly HEALTH_TIMEOUT_MS = 6000;
  private static readonly INVOKE_TIMEOUT_MS = 15_000;
  private static readonly MAX_RESPONSE_BYTES = 256 * 1024; // 256 KiB

  validateConfig(config: AgentEndpointConfig): string | null {
    if (!config?.endpoint) return 'Webhook URL is required';
    let parsed: URL;
    try {
      parsed = new URL(config.endpoint);
    } catch {
      return 'Webhook URL is not a valid URL';
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return 'Webhook URL must be http(s)';
    }
    if (config.endpoint.length > 500) return 'Webhook URL is too long';
    return null;
  }

  async healthCheck(config: AgentEndpointConfig): Promise<AgentHealthResult> {
    const reason = this.validateConfig(config);
    if (reason) return { healthy: false, latencyMs: 0, reason };

    const safe = await isSafeUrlResolving(config.endpoint);
    if (!safe.ok) {
      return { healthy: false, latencyMs: 0, reason: `unsafe_url: ${safe.reason}` };
    }

    const body = JSON.stringify({ event: 'health_check' });
    const headers = this.buildHeaders(body, 'health_check');
    const start = Date.now();
    try {
      const res = await axios.post(config.endpoint, body, {
        headers,
        timeout: WebhookAdapter.HEALTH_TIMEOUT_MS,
        maxRedirects: 0,
        maxBodyLength: WebhookAdapter.MAX_RESPONSE_BYTES,
        maxContentLength: WebhookAdapter.MAX_RESPONSE_BYTES,
        validateStatus: () => true,
      });
      const latencyMs = Date.now() - start;
      // 2xx, 3xx, 4xx all mean the agent answered. 5xx + transport
      // failures count as down. 4xx ("agent refused our payload") is
      // still alive, so we don't kick the listing for it.
      if (res.status >= 500) {
        return { healthy: false, latencyMs, status: res.status, reason: `http_${res.status}` };
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
    if (reason) {
      return { reply: '', latencyMs: 0, raw: { error: reason } };
    }
    const safe = await isSafeUrlResolving(config.endpoint);
    if (!safe.ok) {
      return { reply: '', latencyMs: 0, raw: { error: `unsafe_url: ${safe.reason}` } };
    }

    const body = JSON.stringify({
      event: 'invoke',
      prompt: input.prompt,
      conversationId: input.conversationId ?? null,
      history: input.history ?? [],
    });
    const headers = this.buildHeaders(body, 'invoke');

    const start = Date.now();
    try {
      const res = await axios.post(config.endpoint, body, {
        headers,
        timeout: WebhookAdapter.INVOKE_TIMEOUT_MS,
        maxRedirects: 0,
        maxBodyLength: WebhookAdapter.MAX_RESPONSE_BYTES,
        maxContentLength: WebhookAdapter.MAX_RESPONSE_BYTES,
        validateStatus: () => true,
        responseType: 'json',
      });
      const latencyMs = Date.now() - start;

      if (res.status >= 400) {
        return {
          reply: '',
          latencyMs,
          raw: { status: res.status, body: res.data },
        };
      }

      const data = res.data ?? {};
      const reply = typeof data.reply === 'string' ? data.reply : '';
      const action =
        data.action && typeof data.action === 'object' ? (data.action as { type: string }) : null;
      return { reply, action, latencyMs, raw: data };
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
      'X-Haggl-Event': event,
      'User-Agent': 'HagglAgentPing/1.0',
    };
    if (secret) {
      const signed = signRequest(body, secret);
      Object.assign(headers, signed);
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
