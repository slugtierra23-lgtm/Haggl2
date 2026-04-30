import { spawn } from 'child_process';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { Injectable, Logger } from '@nestjs/common';

import type { Finding, Severity } from './hagglguard.service';

const RULES_DIR = process.env.HAGGLGUARD_RULES_DIR ?? path.join(process.cwd(), 'hagglguard-rules');
const SEMGREP_TIMEOUT_MS = 30_000;

interface SemgrepResult {
  results: Array<{
    check_id: string;
    path: string;
    start: { line: number };
    extra: {
      severity: 'INFO' | 'WARNING' | 'ERROR';
      message: string;
      metadata?: {
         haggl_severity?: Severity;
         haggl_fix?: string;
      };
    };
  }>;
}

/**
 * Wrapper around the Semgrep CLI. Writes the snippet to a temp file,
 * runs Semgrep with our custom yaml rule pack, parses JSON output to
 * `Finding[]`. Returns an empty array (with a warning log) if the
 * binary is missing — local dev without semgrep installed shouldn't
 * break the publish flow.
 */
@Injectable()
export class SemgrepRunner {
  private readonly logger = new Logger(SemgrepRunner.name);
  private rulesDirCheckedAt = 0;
  private rulesDirOk: boolean | null = null;

  /** Run Semgrep against an in-memory code blob. fileName drives
   *  language inference (we keep the extension so semgrep picks up
   *  the right rules). */
  async scan(code: string, fileName: string): Promise<Finding[]> {
    if (!this.rulesAvailable()) return [];

    const ext = inferExtension(fileName);
    const tmpDir = await this.makeTempDir();
    const tmpFile = path.join(tmpDir, `snippet${ext}`);

    try {
      await fs.promises.writeFile(tmpFile, code, 'utf-8');
      const out = await this.runSemgrep(tmpFile);
      return out;
    } catch (err) {
      this.logger.warn(`Semgrep failed: ${(err as Error).message}`);
      return [];
    } finally {
      await fs.promises.rm(tmpDir, { recursive: true, force: true }).catch(() => void 0);
    }
  }

  // ── Internals ──────────────────────────────────────────────────────

  private rulesAvailable(): boolean {
    // Cache the dir-exists check for 60s. If the rules dir isn't
    // mounted (e.g. local dev without the Docker setup) we skip
    // Semgrep silently.
    const now = Date.now();
    if (this.rulesDirOk !== null && now - this.rulesDirCheckedAt < 60_000) {
      return this.rulesDirOk;
    }
    this.rulesDirCheckedAt = now;
    try {
      const stat = fs.statSync(RULES_DIR);
      this.rulesDirOk = stat.isDirectory();
    } catch {
      this.rulesDirOk = false;
    }
    return this.rulesDirOk;
  }

  private async makeTempDir(): Promise<string> {
    const id = crypto.randomBytes(8).toString('hex');
    const dir = path.join(os.tmpdir(), `hagglguard-${id}`);
    await fs.promises.mkdir(dir, { recursive: true });
    return dir;
  }

  private runSemgrep(target: string): Promise<Finding[]> {
    return new Promise((resolve) => {
      // --json for parseable output, --quiet to suppress progress,
      // --metrics=off to skip the telemetry call (slow on cold runs).
      const proc = spawn(
        'semgrep',
        ['--json', '--quiet', '--metrics=off', '--timeout=15', '--config', RULES_DIR, target],
        { stdio: ['ignore', 'pipe', 'pipe'] },
      );

      let stdout = '';
      let stderr = '';
      const killer = setTimeout(() => {
        proc.kill('SIGKILL');
      }, SEMGREP_TIMEOUT_MS);

      proc.stdout.on('data', (b) => {
        stdout += b.toString();
      });
      proc.stderr.on('data', (b) => {
        stderr += b.toString();
      });
      proc.on('error', (err) => {
        clearTimeout(killer);
        this.logger.warn(`semgrep spawn error: ${err.message}`);
        resolve([]);
      });
      proc.on('close', () => {
        clearTimeout(killer);
        if (!stdout) {
          if (stderr) this.logger.debug(`semgrep stderr: ${stderr.slice(0, 400)}`);
          resolve([]);
          return;
        }
        try {
          const parsed = JSON.parse(stdout) as SemgrepResult;
          const findings = (parsed.results ?? []).map((r) => mapResult(r));
          resolve(findings);
        } catch (err) {
          this.logger.warn(`semgrep json parse failed: ${(err as Error).message}`);
          resolve([]);
        }
      });
    });
  }
}

function inferExtension(fileName: string): string {
  const m = fileName.match(/\.([a-z0-9]+)$/i);
  if (!m) return '.txt';
  const ext = m[1].toLowerCase();
  // Whitelist — anything else degrades to .txt and Semgrep's generic rules.
  if (['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'py', 'go', 'rb', 'rs', 'java'].includes(ext)) {
    return `.${ext}`;
  }
  return '.txt';
}

function mapResult(r: SemgrepResult['results'][0]): Finding {
  const sevFromMeta = r.extra.metadata?.haggl_severity;
  const severity: Severity =
    sevFromMeta && isSeverity(sevFromMeta)
      ? sevFromMeta
      : r.extra.severity === 'ERROR'
        ? 'HIGH'
        : r.extra.severity === 'WARNING'
          ? 'MEDIUM'
          : 'LOW';

  const ruleShort = r.check_id.split('.').pop() ?? r.check_id;

  return {
    rule: ruleShort.slice(0, 80),
    severity,
    file: path.basename(r.path),
    line: r.start.line,
    message: r.extra.message.slice(0, 400),
    fix: r.extra.metadata?.haggl_fix?.slice(0, 400),
  };
}

function isSeverity(v: string): v is Severity {
  return v === 'CRITICAL' || v === 'HIGH' || v === 'MEDIUM' || v === 'LOW' || v === 'INFO';
}
