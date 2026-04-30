import * as crypto from 'crypto';

/**
 * HMAC signing for outbound agent webhooks.
 *
 * Every request Bolty sends to a seller's agent endpoint carries a
 * signature header so the agent can prove the call really came from
 * Bolty (and not from anyone who guessed the URL). Format mirrors the
 * Stripe / GitHub webhook style for familiarity:
 *
 *   X-Bolty-Signature: t=<unix_ts>,v1=<hex_hmac_sha256>
 *
 *   v1 = HMAC-SHA256(secret, `${t}.${rawBody}`)
 *
 * Replay protection: the signed string includes the timestamp, and
 * the receiver MUST reject anything older than {@link MAX_SKEW_SEC}.
 *
 * The secret used here is the platform-wide AGENT_HMAC_SECRET env
 * var. Per-listing secrets are a follow-up; the platform-wide key
 * keeps the v1 launch path surgical (no DB migration, no UI to show
 * a one-time secret).
 */

/** Reject signatures whose timestamp is more than this many seconds in
 *  the past or future. 5 min covers reasonable clock skew between
 *  Bolty + the agent host while still defeating long replay windows. */
export const MAX_SKEW_SEC = 300;

/** Header name agents look for in the incoming request. Lower-cased
 *  in tests because Node's `req.headers` lowercases automatically. */
export const SIGNATURE_HEADER = 'x-bolty-signature';

export interface SignedHeaders {
  [SIGNATURE_HEADER]: string;
  'x-bolty-timestamp': string;
}

/**
 * Build the headers a signed outbound request carries. `body` is the
 * raw JSON string the request will send — must match exactly what the
 * receiver re-serialises, otherwise the HMAC won't match.
 */
export function signRequest(
  body: string,
  secret: string,
  nowMs: number = Date.now(),
): SignedHeaders {
  if (!secret) {
    // Defensive: never sign with empty secret. The caller is supposed
    // to guard but this throws fast in tests if a misconfig sneaks in.
    throw new Error('AGENT_HMAC_SECRET is not configured');
  }
  const ts = Math.floor(nowMs / 1000).toString();
  const sig = crypto.createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex');
  return {
    [SIGNATURE_HEADER]: `t=${ts},v1=${sig}`,
    'x-bolty-timestamp': ts,
  };
}

/**
 * Verify an incoming signed request. Returns true only if the signature
 * matches AND the timestamp is within {@link MAX_SKEW_SEC} of `nowMs`.
 *
 * Used by the test endpoint to round-trip its own signature (sanity
 * check for the docs examples), and exported so anyone building a
 * Node.js agent on top of Bolty can `import { verifyRequest } from
 * '@boltynetwork/agent-sdk'` and reuse the exact same logic.
 */
export function verifyRequest(
  body: string,
  signatureHeader: string,
  secret: string,
  nowMs: number = Date.now(),
): { valid: boolean; reason?: 'malformed' | 'expired' | 'mismatch' | 'no_secret' } {
  if (!secret) return { valid: false, reason: 'no_secret' };
  if (!signatureHeader) return { valid: false, reason: 'malformed' };

  const parts = signatureHeader.split(',').map((p) => p.trim());
  const tPart = parts.find((p) => p.startsWith('t='));
  const vPart = parts.find((p) => p.startsWith('v1='));
  if (!tPart || !vPart) return { valid: false, reason: 'malformed' };

  const ts = Number(tPart.slice(2));
  const sig = vPart.slice(3);
  if (!Number.isFinite(ts) || !sig) return { valid: false, reason: 'malformed' };

  const skewSec = Math.abs(Math.floor(nowMs / 1000) - ts);
  if (skewSec > MAX_SKEW_SEC) return { valid: false, reason: 'expired' };

  const expected = crypto.createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex');

  // Constant-time compare avoids leaking byte-by-byte mismatch info to
  // a timing-side-channel attacker.
  const a = Buffer.from(sig, 'hex');
  const b = Buffer.from(expected, 'hex');
  if (a.length !== b.length) return { valid: false, reason: 'mismatch' };
  if (!crypto.timingSafeEqual(a, b)) return { valid: false, reason: 'mismatch' };

  return { valid: true };
}
