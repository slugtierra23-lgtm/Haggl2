import { Injectable, Logger } from '@nestjs/common';

import { BundleScanner } from './bundle-scanner';

/**
 * Fetches a public GitHub repo as a tarball/zipball and hands it to
 * the BundleScanner. SSRF + size guards live here:
 *
 *  - URL must resolve to a public github.com repo (no enterprise
 *    hostnames; no api.github.com paths the user can craft).
 *  - We pull the zipball through the GitHub REST API which returns
 *    a redirect to codeload.github.com — both are allowlisted.
 *  - Read body in chunks, abort the moment we exceed the cap.
 *  - Hand the buffer to BundleScanner which re-applies its own caps
 *    (entries, per-file size, ratio, traversal, symlinks).
 *
 * No git binary needed. No subprocess. Memory-only.
 */
@Injectable()
export class GithubFetcher {
  private readonly logger = new Logger(GithubFetcher.name);

  // Hard cap on the zipball download. Same as BundleScanner.MAX_ZIP_BYTES.
  static readonly MAX_DOWNLOAD_BYTES = BundleScanner.MAX_ZIP_BYTES;
  static readonly DOWNLOAD_TIMEOUT_MS = 20_000;
  // 10-minute LRU cache keyed by `owner/repo@ref?`. Without a
  // GITHUB_TOKEN the public API rate-limits at 60 req/h per IP, so
  // caching repeated scans of the same repo is the difference between
  // the public scanner being usable and being throttled by 11am.
  static readonly CACHE_TTL_MS = 10 * 60 * 1000;
  static readonly MAX_CACHE_ENTRIES = 32;
  private readonly cache = new Map<string, { buffer: Buffer; cachedAt: number }>();

  /** Parse `owner/repo` or a full URL → { owner, repo, ref? }.
   *  Returns null if the input doesn't point at a github.com repo. */
  parseRepoSpec(input: string): {
    owner: string;
    repo: string;
    ref?: string;
  } | null {
    const trimmed = (input || '').trim();
    if (!trimmed) return null;

    // owner/repo (no host)
    const short = /^([a-zA-Z0-9_.-]{1,39})\/([a-zA-Z0-9_.-]{1,100})$/;
    const shortMatch = short.exec(trimmed);
    if (shortMatch) {
      return { owner: shortMatch[1], repo: stripDotGit(shortMatch[2]) };
    }

    let url: URL;
    try {
      url = new URL(trimmed.startsWith('http') ? trimmed : `https://${trimmed}`);
    } catch {
      return null;
    }
    if (url.hostname !== 'github.com' && url.hostname !== 'www.github.com') {
      return null;
    }
    // /owner/repo[/tree/branch][/...]
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts.length < 2) return null;
    const owner = parts[0];
    const repo = stripDotGit(parts[1]);
    if (!/^[a-zA-Z0-9_.-]+$/.test(owner) || !/^[a-zA-Z0-9_.-]+$/.test(repo)) {
      return null;
    }
    let ref: string | undefined;
    if (parts[2] === 'tree' && parts[3]) {
      // /tree/<ref>/<...path?>  — only the ref is useful to us.
      ref = parts.slice(3).join('/');
      if (ref.length > 80) ref = undefined;
    }
    return { owner, repo, ref };
  }

  /** Download the repo as a zip into memory. Aborts if it exceeds
   *  MAX_DOWNLOAD_BYTES. Throws a useful error on every failure
   *  mode so the controller can surface it. Cached for 10min so a
   *  burst of scans on the same repo doesn't burn the API quota. */
  async fetchZip(spec: { owner: string; repo: string; ref?: string }): Promise<Buffer> {
    const cacheKey = `${spec.owner}/${spec.repo}@${spec.ref ?? 'HEAD'}`;
    const hit = this.cache.get(cacheKey);
    if (hit && Date.now() - hit.cachedAt < GithubFetcher.CACHE_TTL_MS) {
      return hit.buffer;
    }

    // GitHub returns 302 to codeload.github.com which is also fine.
    const path = spec.ref
      ? `/repos/${enc(spec.owner)}/${enc(spec.repo)}/zipball/${enc(spec.ref)}`
      : `/repos/${enc(spec.owner)}/${enc(spec.repo)}/zipball`;
    const url = `https://api.github.com${path}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), GithubFetcher.DOWNLOAD_TIMEOUT_MS);

    try {
      const headers: Record<string, string> = {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'BoltyGuard/1.0 (+https://bolty.network)',
      };
      const token = process.env.GITHUB_TOKEN;
      if (token) headers.Authorization = `Bearer ${token}`;
      const res = await fetch(url, {
        method: 'GET',
        signal: controller.signal,
        headers,
        redirect: 'follow',
      });
      if (res.status === 404) {
        throw new Error(`repo not found: ${spec.owner}/${spec.repo}`);
      }
      if (res.status === 403) {
        throw new Error('GitHub rate limit hit. Try again in a minute.');
      }
      if (!res.ok) {
        throw new Error(`GitHub returned ${res.status}`);
      }
      // Verify the final URL is one we trust. After follow it should
      // be codeload.github.com or objects.githubusercontent.com.
      const finalHost = new URL(res.url).hostname;
      const allowedHosts = new Set([
        'codeload.github.com',
        'objects.githubusercontent.com',
        'github.com',
        'api.github.com',
      ]);
      if (!allowedHosts.has(finalHost)) {
        throw new Error(`unexpected redirect host: ${finalHost}`);
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error('GitHub returned an empty body');
      const chunks: Uint8Array[] = [];
      let total = 0;
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        if (!value) continue;
        total += value.byteLength;
        if (total > GithubFetcher.MAX_DOWNLOAD_BYTES) {
          await reader.cancel().catch(() => void 0);
          throw new Error(`repo zipball exceeds ${GithubFetcher.MAX_DOWNLOAD_BYTES} bytes`);
        }
        chunks.push(value);
      }
      const buf = Buffer.concat(chunks.map((c) => Buffer.from(c)));
      // Trim oldest entries before inserting so the map can't grow
      // unbounded under traffic.
      if (this.cache.size >= GithubFetcher.MAX_CACHE_ENTRIES) {
        const oldestKey = this.cache.keys().next().value;
        if (oldestKey) this.cache.delete(oldestKey);
      }
      this.cache.set(cacheKey, { buffer: buf, cachedAt: Date.now() });
      return buf;
    } finally {
      clearTimeout(timer);
    }
  }
}

function enc(s: string): string {
  return encodeURIComponent(s);
}

function stripDotGit(s: string): string {
  return s.replace(/\.git$/i, '');
}
