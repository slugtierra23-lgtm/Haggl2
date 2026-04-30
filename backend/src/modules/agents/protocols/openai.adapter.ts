import { Injectable, Logger } from '@nestjs/common';
import axios, { AxiosError } from 'axios';

import { isSafeUrlResolving } from '../../../common/sanitize/sanitize.util';

import {
  AgentEndpointConfig,
  AgentHealthResult,
  AgentInvokeInput,
  AgentInvokeOutput,
  IProtocolAdapter,
  ProtocolKind,
} from './protocol-adapter.interface';

/**
 * OpenAI-compatible chat completions adapter.
 *
 * Hits the standard `/v1/chat/completions` shape that OpenAI, Together,
 * Groq, OpenRouter, vLLM, llama.cpp's HTTP server, and most local LLM
 * runtimes expose. The seller supplies:
 *
 *   - `endpoint`: full URL, e.g. https://api.openai.com/v1/chat/completions
 *   - `model`:    model id, e.g. gpt-4o-mini, claude-3.5-sonnet, …
 *   - `apiKey`:   bearer token forwarded as `Authorization: Bearer …`
 *
 * We do NOT sign with HMAC here — the agent isn't a Bolty-aware
 * service, it's a raw inference endpoint. Auth is the seller's bearer
 * token; we proxy it verbatim.
 *
 * Health check uses a 1-token completion against the seller's model.
 * Cheap (~$0.00001), real, and proves the model id + auth are good.
 */
@Injectable()
export class OpenAiAdapter implements IProtocolAdapter {
  readonly kind: ProtocolKind = 'openai';

  private readonly logger = new Logger(OpenAiAdapter.name);
  private static readonly HEALTH_TIMEOUT_MS = 8000;
  private static readonly INVOKE_TIMEOUT_MS = 30_000;
  private static readonly MAX_RESPONSE_BYTES = 1024 * 1024;
  private static readonly INVOKE_MAX_TOKENS = 512;

  validateConfig(config: AgentEndpointConfig): string | null {
    if (!config?.endpoint) return 'API endpoint is required';
    let parsed: URL;
    try {
      parsed = new URL(config.endpoint);
    } catch {
      return 'API endpoint is not a valid URL';
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return 'API endpoint must be http(s)';
    }
    if (config.endpoint.length > 500) return 'API endpoint is too long';
    if (!config.model || !config.model.trim()) return 'Model id is required';
    if (config.model.length > 80) return 'Model id is too long';
    if (config.apiKey && config.apiKey.length > 256) return 'API key is too long';
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
      model: config.model,
      messages: [{ role: 'user', content: 'ping' }],
      max_tokens: 1,
      temperature: 0,
    });

    const start = Date.now();
    try {
      const res = await axios.post(config.endpoint, body, {
        headers: this.buildHeaders(config),
        timeout: OpenAiAdapter.HEALTH_TIMEOUT_MS,
        maxRedirects: 0,
        maxBodyLength: OpenAiAdapter.MAX_RESPONSE_BYTES,
        maxContentLength: OpenAiAdapter.MAX_RESPONSE_BYTES,
        validateStatus: () => true,
      });
      const latencyMs = Date.now() - start;

      if (res.status >= 500) {
        return { healthy: false, latencyMs, status: res.status, reason: `http_${res.status}` };
      }
      if (res.status === 401 || res.status === 403) {
        return { healthy: false, latencyMs, status: res.status, reason: 'auth_failed' };
      }
      if (res.status === 404) {
        return {
          healthy: false,
          latencyMs,
          status: res.status,
          reason: 'endpoint_or_model_missing',
        };
      }
      if (res.status >= 400) {
        const detail =
          typeof res.data?.error?.message === 'string'
            ? res.data.error.message.slice(0, 120)
            : `http_${res.status}`;
        return { healthy: false, latencyMs, status: res.status, reason: detail };
      }

      // 2xx — must be a parseable chat completion.
      const choices = res.data?.choices;
      if (!Array.isArray(choices) || choices.length === 0) {
        return { healthy: false, latencyMs, status: res.status, reason: 'no_choices' };
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

    // Compose messages: history first, then the new user prompt. Each
    // role + content tuple maps 1-to-1 onto the OpenAI message format.
    const messages = [
      ...(input.history ?? []).map((m) => ({ role: m.role, content: m.content })),
      { role: 'user' as const, content: input.prompt },
    ];
    const body = JSON.stringify({
      model: config.model,
      messages,
      max_tokens: OpenAiAdapter.INVOKE_MAX_TOKENS,
      temperature: 0.7,
    });

    const start = Date.now();
    try {
      const res = await axios.post(config.endpoint, body, {
        headers: this.buildHeaders(config),
        timeout: OpenAiAdapter.INVOKE_TIMEOUT_MS,
        maxRedirects: 0,
        maxBodyLength: OpenAiAdapter.MAX_RESPONSE_BYTES,
        maxContentLength: OpenAiAdapter.MAX_RESPONSE_BYTES,
        validateStatus: () => true,
      });
      const latencyMs = Date.now() - start;

      if (res.status >= 400) {
        return { reply: '', latencyMs, raw: { status: res.status, body: res.data } };
      }
      const choice = res.data?.choices?.[0];
      const content = choice?.message?.content;
      const reply = typeof content === 'string' ? content : '';
      return { reply, latencyMs, raw: res.data };
    } catch (err) {
      return {
        reply: '',
        latencyMs: Date.now() - start,
        raw: { error: this.summarize(err) },
      };
    }
  }

  private buildHeaders(config: AgentEndpointConfig): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'User-Agent': 'BoltyOpenAiClient/1.0',
    };
    if (config.apiKey) {
      headers.Authorization = `Bearer ${config.apiKey}`;
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
