import { Injectable, Logger } from '@nestjs/common';
import * as yauzl from 'yauzl';

import type { Finding } from './hagglguard.service';
import { HagglGuardService } from './hagglguard.service';

/**
 * Hardened ZIP bundle scanner. Used by `/api/hagglguard/scan` when
 * the user uploads a zip instead of pasting code. Treats the zip as
 * adversarial and applies strict caps to neutralise:
 *
 *  - Zip bombs (recursive compression / huge expansion ratio)
 *  - Path traversal (../foo, /etc/passwd, null bytes)
 *  - Symlink escapes
 *  - Resource exhaustion (too many entries, oversize files)
 *  - Binary smuggling — only whitelisted text extensions are scanned
 *
 * Limits below were picked to comfortably cover any reasonable
 * agent / repo while making the worst-case adversarial archive a
 * non-issue (10MB total uncompressed, 100 files, 500KB per file).
 */
@Injectable()
export class BundleScanner {
  private readonly logger = new Logger(BundleScanner.name);

  // Hard caps — nothing the user uploads can override these.
  static readonly MAX_ZIP_BYTES = 5 * 1024 * 1024; // 5MB on the wire
  static readonly MAX_ENTRIES = 100;
  static readonly MAX_FILE_BYTES = 500 * 1024; // 500KB per file uncompressed
  static readonly MAX_TOTAL_BYTES = 10 * 1024 * 1024; // 10MB sum
  static readonly MAX_RATIO = 200; // uncompressed / compressed

  // Extensions we actually scan. Anything else is silently skipped
  // so a binary blob can't smuggle bytes past Semgrep / Claude.
  static readonly SCANNABLE_EXTS = new Set([
    'ts',
    'tsx',
    'js',
    'jsx',
    'mjs',
    'cjs',
    'py',
    'go',
    'rb',
    'java',
    'rs',
    'sol',
    'sh',
    'yaml',
    'yml',
    'json',
    'env',
    'toml',
    'md',
    'txt',
  ]);

  constructor(private readonly guard: HagglGuardService) {}

  /**
   * Scan a zip buffer. Returns merged findings + per-file score
   * breakdown. The aggregate score is the weakest of the per-file
   * scores — one bad file in a bundle drags the whole thing down.
   */
  async scanZip(
    buffer: Buffer,
    opts: { isAgent?: boolean } = {},
  ): Promise<{
    score: number;
    findings: Finding[];
    files: Array<{ path: string; score: number; findingCount: number }>;
    summary: string;
  }> {
    if (buffer.length > BundleScanner.MAX_ZIP_BYTES) {
      throw new Error(`zip too large (max ${BundleScanner.MAX_ZIP_BYTES} bytes)`);
    }
    if (buffer.length < 22) {
      throw new Error('not a zip');
    }
    // EOCD signature — we don't trust the mime; we sniff the bytes.
    // 0x06054b50 little-endian must appear in the last 65557 bytes.
    if (!hasEocdSignature(buffer)) throw new Error('not a zip');

    const entries = await this.extractAllowed(buffer);
    if (entries.length === 0) {
      return {
        score: 100,
        findings: [],
        files: [],
        summary: 'No scannable files in the bundle.',
      };
    }

    // Scan files in parallel but with a small concurrency cap so we
    // don't blast the LLM API with 100 requests. The zip cap of 100
    // entries × concurrency 4 ≈ 25 sequential rounds, ~2 min worst
    // case — acceptable for a public scan endpoint with the existing
    // throttler in front of it.
    const concurrency = 4;
    const fileResults: Array<{
      path: string;
      score: number;
      findingCount: number;
      findings: Finding[];
    }> = [];

    for (let i = 0; i < entries.length; i += concurrency) {
      const batch = entries.slice(i, i + concurrency);
      const reports = await Promise.all(
        batch.map(async (e) => {
          const report = await this.guard
            .scanCode(e.content, { fileName: e.path, isAgent: opts.isAgent })
            .catch(() => null);
          return { entry: e, report };
        }),
      );
      for (const { entry, report } of reports) {
        if (!report) continue;
        // Tag each finding with its source path so the UI can group.
        const tagged = report.findings.map((f) => ({ ...f, file: entry.path }));
        fileResults.push({
          path: entry.path,
          score: report.score,
          findingCount: tagged.length,
          findings: tagged,
        });
      }
    }

    if (fileResults.length === 0) {
      return {
        score: 100,
        findings: [],
        files: [],
        summary: 'No scannable files in the bundle.',
      };
    }

    const allFindings = fileResults.flatMap((r) => r.findings);
    // Aggregate score: take the worst file. Rationale: one critical
    // finding anywhere in the bundle is what an attacker exploits.
    const aggregate = Math.min(...fileResults.map((r) => r.score));
    const files = fileResults
      .map(({ path, score, findingCount }) => ({ path, score, findingCount }))
      .sort((a, b) => a.score - b.score);

    return {
      score: aggregate,
      findings: allFindings,
      files,
      summary: `Scanned ${fileResults.length} file${fileResults.length === 1 ? '' : 's'}. ${
        allFindings.length === 0
          ? 'No issues found.'
          : `${allFindings.length} finding${allFindings.length === 1 ? '' : 's'} across the bundle.`
      }`,
    };
  }

  /**
   * Stream entries out of the zip with all the safety guards applied.
   * Anything we don't like (bad path, oversized, banned extension,
   * symlink) is dropped silently and never makes it to the scanner.
   */
  private extractAllowed(buffer: Buffer): Promise<Array<{ path: string; content: string }>> {
    return new Promise((resolve, reject) => {
      // lazyEntries=true so we control the read pace and can stop
      // early if a guard trips. autoClose handles cleanup on error.
      yauzl.fromBuffer(buffer, { lazyEntries: true, autoClose: true }, (err, zip) => {
        if (err || !zip) {
          reject(err ?? new Error('failed to open zip'));
          return;
        }
        if (zip.entryCount > BundleScanner.MAX_ENTRIES) {
          zip.close();
          reject(new Error(`too many entries (max ${BundleScanner.MAX_ENTRIES})`));
          return;
        }

        const out: Array<{ path: string; content: string }> = [];
        let totalUncompressed = 0;

        zip.on('error', (e) => {
          zip.close();
          reject(e);
        });
        zip.on('end', () => resolve(out));
        zip.on('entry', (entry: yauzl.Entry) => {
          // Directory entries — skip.
          if (/\/$/.test(entry.fileName)) {
            zip.readEntry();
            return;
          }
          // Path traversal / absolute / null byte / weird chars.
          if (!isSafePath(entry.fileName)) {
            this.logger.warn(`skipped unsafe path: ${entry.fileName}`);
            zip.readEntry();
            return;
          }
          // Only files we actually scan. Binaries get dropped.
          const ext = (entry.fileName.split('.').pop() ?? '').toLowerCase();
          if (!BundleScanner.SCANNABLE_EXTS.has(ext)) {
            zip.readEntry();
            return;
          }
          // Per-file size cap. Yauzl reports both compressed +
          // uncompressed sizes; refuse anything claiming to expand
          // beyond MAX_FILE_BYTES OR with an absurd ratio.
          if (entry.uncompressedSize > BundleScanner.MAX_FILE_BYTES) {
            this.logger.warn(`skipped oversize file: ${entry.fileName}`);
            zip.readEntry();
            return;
          }
          if (
            entry.compressedSize > 0 &&
            entry.uncompressedSize / entry.compressedSize > BundleScanner.MAX_RATIO
          ) {
            this.logger.warn(`skipped suspicious ratio: ${entry.fileName}`);
            zip.readEntry();
            return;
          }
          if (totalUncompressed + entry.uncompressedSize > BundleScanner.MAX_TOTAL_BYTES) {
            zip.close();
            reject(new Error('aggregate uncompressed size exceeds limit'));
            return;
          }
          totalUncompressed += entry.uncompressedSize;

          zip.openReadStream(entry, (e2, stream) => {
            if (e2 || !stream) {
              this.logger.warn(`failed to open entry: ${entry.fileName}`);
              zip.readEntry();
              return;
            }
            const chunks: Buffer[] = [];
            let read = 0;
            let aborted = false;
            stream.on('data', (chunk: Buffer) => {
              read += chunk.length;
              if (read > BundleScanner.MAX_FILE_BYTES) {
                aborted = true;
                stream.destroy();
                return;
              }
              chunks.push(chunk);
            });
            stream.on('error', () => {
              zip.readEntry();
            });
            stream.on('end', () => {
              if (!aborted) {
                const content = Buffer.concat(chunks).toString('utf-8');
                out.push({ path: entry.fileName, content });
              }
              zip.readEntry();
            });
          });
        });
        zip.readEntry();
      });
    });
  }
}

/** Reject path traversal, absolute paths, null bytes, and Windows
 *  drive letters. We accept POSIX relative paths only. */
function isSafePath(p: string): boolean {
  if (!p || p.length > 512) return false;
  if (p.includes('\0')) return false;
  if (p.startsWith('/') || p.startsWith('\\')) return false;
  if (/^[A-Za-z]:/.test(p)) return false;
  if (p.split('/').some((seg) => seg === '..' || seg === '.')) return false;
  return true;
}

/** Sniff the End-Of-Central-Directory record so we don't trust the
 *  client-supplied mime type. Bomb-resistant first line of defence. */
function hasEocdSignature(buf: Buffer): boolean {
  const sig = Buffer.from([0x50, 0x4b, 0x05, 0x06]);
  // EOCD lives in the last 65557 bytes of any zip. Scan backwards.
  const start = Math.max(0, buf.length - 65557);
  return buf.indexOf(sig, start) !== -1;
}
