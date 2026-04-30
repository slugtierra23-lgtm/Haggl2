/**
 * Common shape every protocol adapter implements. The test endpoint +
 * future invocation paths consume adapters polymorphically — they only
 * know about this interface, not the underlying transport.
 */

export type ProtocolKind = 'webhook' | 'mcp' | 'openai';

export interface AgentInvokeInput {
  /** Free text from the buyer / haggl internals. */
  prompt: string;
  /** Optional conversation id when the adapter supports multi-turn. */
  conversationId?: string;
  /** Optional ordered transcript so the agent can reconstruct context. */
  history?: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
}

/** The normalised output every adapter must produce. */
export interface AgentInvokeOutput {
  /** The reply text the buyer sees. Always present, possibly empty. */
  reply: string;
  /** Optional structured action the agent wants haggl to take. */
  action?: { type: string; data?: unknown } | null;
  /** Round-trip latency in milliseconds, set by the adapter. */
  latencyMs: number;
  /** Raw protocol-specific debug info — surfaced in the test panel. */
  raw?: unknown;
}

/** Result of {@link IProtocolAdapter.healthCheck}. */
export interface AgentHealthResult {
  healthy: boolean;
  latencyMs: number;
  /** Free-text reason when `healthy === false`. */
  reason?: string;
  /** HTTP status the adapter saw, when applicable. */
  status?: number;
}

/** What the test-deploy endpoint returns to the publish form. */
export interface AgentTestResult {
  protocol: ProtocolKind;
  health: AgentHealthResult;
  invoke?: {
    ok: boolean;
    latencyMs: number;
    reply?: string;
    error?: string;
    /** True when the response shape matched the protocol spec. */
    schemaValid?: boolean;
  };
}

/**
 * Protocol-specific config the seller supplies in the publish form.
 * Each adapter validates its own shape (URL must be HTTPS, model must
 * be non-empty, etc.) and rejects with a structured reason.
 */
export interface AgentEndpointConfig {
  endpoint: string;
  /** OpenAI-compatible only. */
  model?: string;
  /** OpenAI-compatible only. Bearer token to forward. */
  apiKey?: string;
}

export interface IProtocolAdapter {
  readonly kind: ProtocolKind;

  /**
   * Cheap probe — typically one HTTP call. Used by the cron health
   * sweep + the publish-form Test button. MUST be cheap to call from
   * the agent's perspective; we don't pass the full prompt here.
   */
  healthCheck(config: AgentEndpointConfig): Promise<AgentHealthResult>;

  /**
   * Round-trip a single sample invocation end-to-end. Used by the
   * publish form to prove the agent both responds AND returns a body
   * we can parse. The `latencyMs` is wall-clock from request send to
   * parsed response.
   */
  invoke(config: AgentEndpointConfig, input: AgentInvokeInput): Promise<AgentInvokeOutput>;

  /**
   * Quick structural validation of the user-supplied config. Returns
   * null when valid, otherwise a human-readable reason the form can
   * surface inline before any network call.
   */
  validateConfig(config: AgentEndpointConfig): string | null;
}
