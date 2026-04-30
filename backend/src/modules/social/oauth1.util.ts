import * as crypto from 'crypto';

/**
 * Standalone OAuth 1.0a signing for X (Twitter) API requests.
 *
 * X's docs: https://developer.x.com/en/docs/authentication/oauth-1-0a/authorizing-a-request
 *
 * We don't pull a third-party OAuth library because the spec is small,
 * the dep surface for crypto-touching code matters, and we want every
 * line on the path to be auditable. Implements RFC 5849 with the
 * subset of behaviour X actually uses (HMAC-SHA1, query/body params
 * folded into the signature base, percent-encoded with the OAuth
 * variant of percent-encoding).
 */

export interface Oauth1Credentials {
  consumerKey: string;
  consumerSecret: string;
  accessToken: string;
  accessTokenSecret: string;
}

/**
 * Build the value of the `Authorization` header for a single signed
 * request. `params` should include all body params for
 * application/x-www-form-urlencoded POSTs, AND all query params for
 * GETs. For application/json POSTs (which is what X v2 wants), pass
 * an empty object — the JSON body does NOT participate in the
 * signature.
 */
export function buildAuthHeader(
  method: string,
  url: string,
  params: Record<string, string>,
  creds: Oauth1Credentials,
  nonce: string = randomNonce(),
  timestamp: string = Math.floor(Date.now() / 1000).toString(),
): string {
  const oauthParams: Record<string, string> = {
    oauth_consumer_key: creds.consumerKey,
    oauth_nonce: nonce,
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: timestamp,
    oauth_token: creds.accessToken,
    oauth_version: '1.0',
  };

  const allParams = { ...params, ...oauthParams };
  const baseString = signatureBaseString(method, url, allParams);
  const signingKey = `${rfc3986(creds.consumerSecret)}&${rfc3986(creds.accessTokenSecret)}`;
  const signature = crypto.createHmac('sha1', signingKey).update(baseString).digest('base64');

  oauthParams.oauth_signature = signature;

  const headerParts = Object.keys(oauthParams)
    .sort()
    .map((k) => `${rfc3986(k)}="${rfc3986(oauthParams[k])}"`)
    .join(', ');
  return `OAuth ${headerParts}`;
}

/**
 * Build the canonical signature base string per RFC 5849 §3.4.1.
 * Exposed for tests so we can lock in a known vector against X's
 * documented examples.
 */
export function signatureBaseString(
  method: string,
  url: string,
  params: Record<string, string>,
): string {
  const sortedKeys = Object.keys(params).sort();
  const paramString = sortedKeys.map((k) => `${rfc3986(k)}=${rfc3986(params[k])}`).join('&');
  // X's docs require the URL to be lowercased on host, and stripped of
  // default ports + fragment + query. We assume callers pass clean
  // URLs so just split off any query portion as a defense in depth.
  const u = new URL(url);
  const cleanUrl = `${u.protocol}//${u.host}${u.pathname}`;
  return [method.toUpperCase(), rfc3986(cleanUrl), rfc3986(paramString)].join('&');
}

/** OAuth percent-encoding — stricter than encodeURIComponent. */
export function rfc3986(input: string): string {
  return encodeURIComponent(input).replace(
    /[!'()*]/g,
    (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase(),
  );
}

function randomNonce(): string {
  return crypto.randomBytes(16).toString('hex');
}
