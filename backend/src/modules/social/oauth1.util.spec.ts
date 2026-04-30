import { buildAuthHeader, rfc3986, signatureBaseString } from './oauth1.util';

/**
 * Synthetic test vectors. Earlier revisions of this file used the
 * example credentials from X's public OAuth 1.0a documentation; even
 * though those values are fake (X's own teaching examples that have
 * been on the internet for over a decade), GitHub's secret-scanning
 * matched the format and flagged the file. Replaced with fully
 * synthetic strings so the scanner stays quiet.
 */

const FIXTURE = {
  consumerKey: 'EXAMPLE_CK_1234567890',
  consumerSecret: 'EXAMPLE_CS_zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz',
  accessToken: '999999999-EXAMPLE_TOKEN_1234567890abcdef',
  accessTokenSecret: 'EXAMPLE_ATS_zzzzzzzzzzzzzzzzzzzzzzzzzzzzzz',
  nonce: 'EXAMPLE_NONCE_abcdefghijklmnop',
  timestamp: '1700000000',
  status: 'Hello Ladies + Gentlemen, a signed OAuth request!',
};

describe('oauth1.util', () => {
  describe('rfc3986', () => {
    it('encodes the OAuth-special chars beyond encodeURIComponent', () => {
      expect(rfc3986("!'()*")).toBe('%21%27%28%29%2A');
    });
    it('matches encodeURIComponent for the safe set', () => {
      expect(rfc3986('abc-123_~.')).toBe('abc-123_~.');
    });
    it('encodes spaces as %20 (not +)', () => {
      expect(rfc3986('hello world')).toBe('hello%20world');
    });
  });

  describe('signatureBaseString', () => {
    it('produces the canonical base string per RFC 5849 with sorted params + percent encoding', () => {
      const base = signatureBaseString('POST', 'https://api.twitter.com/1.1/statuses/update.json', {
        status: FIXTURE.status,
        oauth_consumer_key: FIXTURE.consumerKey,
        oauth_nonce: FIXTURE.nonce,
        oauth_signature_method: 'HMAC-SHA1',
        oauth_timestamp: FIXTURE.timestamp,
        oauth_token: FIXTURE.accessToken,
        oauth_version: '1.0',
      });
      // Locked-in vector. Any change in encoding / sort order breaks
      // this assertion, which is the whole point.
      expect(base).toBe(
        'POST&https%3A%2F%2Fapi.twitter.com%2F1.1%2Fstatuses%2Fupdate.json' +
          '&oauth_consumer_key%3DEXAMPLE_CK_1234567890' +
          '%26oauth_nonce%3DEXAMPLE_NONCE_abcdefghijklmnop' +
          '%26oauth_signature_method%3DHMAC-SHA1' +
          '%26oauth_timestamp%3D1700000000' +
          '%26oauth_token%3D999999999-EXAMPLE_TOKEN_1234567890abcdef' +
          '%26oauth_version%3D1.0' +
          '%26status%3DHello%2520Ladies%2520%252B%2520Gentlemen%252C%2520a%2520signed%2520OAuth%2520request%2521',
      );
    });

    it('strips query strings + fragments from the canonical URL', () => {
      const sig = signatureBaseString('POST', 'https://api.twitter.com/2/tweets?ignored=1#frag', {
        foo: 'bar',
      });
      expect(sig).toBe('POST&https%3A%2F%2Fapi.twitter.com%2F2%2Ftweets&foo%3Dbar');
    });
  });

  describe('buildAuthHeader', () => {
    it('produces a deterministic signature for fixed nonce + timestamp', () => {
      const header = buildAuthHeader(
        'POST',
        'https://api.twitter.com/1.1/statuses/update.json',
        { status: FIXTURE.status },
        FIXTURE,
        FIXTURE.nonce,
        FIXTURE.timestamp,
      );
      // Locked-in vector — HMAC-SHA1(signing_key, base_string) for the
      // synthetic FIXTURE inputs above.
      expect(header).toContain('oauth_signature="9V7MahP%2B7AolS8BhrN238OG7FCc%3D"');
      expect(header).toContain(`oauth_consumer_key="${FIXTURE.consumerKey}"`);
      expect(header).toContain(`oauth_nonce="${FIXTURE.nonce}"`);
      expect(header).toContain('oauth_signature_method="HMAC-SHA1"');
      expect(header).toContain(`oauth_timestamp="${FIXTURE.timestamp}"`);
    });

    it('returns an OAuth header even when no body params are supplied', () => {
      const header = buildAuthHeader(
        'GET',
        'https://api.twitter.com/2/users/me',
        {},
        {
          consumerKey: 'CK',
          consumerSecret: 'CS',
          accessToken: 'AT',
          accessTokenSecret: 'ATS',
        },
        'fixed-nonce',
        '1700000000',
      );
      expect(header.startsWith('OAuth ')).toBe(true);
      expect(header).toContain('oauth_signature=');
      expect(header).toContain('oauth_token="AT"');
    });

    it('different nonce or timestamp = different signature', () => {
      const args = [
        'POST',
        'https://api.twitter.com/2/tweets',
        {},
        { consumerKey: 'k', consumerSecret: 's', accessToken: 't', accessTokenSecret: 'ts' },
      ] as const;
      const a = buildAuthHeader(...args, 'nonce-a', '1700000000');
      const b = buildAuthHeader(...args, 'nonce-b', '1700000000');
      const c = buildAuthHeader(...args, 'nonce-a', '1700000001');
      expect(a).not.toBe(b);
      expect(a).not.toBe(c);
    });
  });
});
