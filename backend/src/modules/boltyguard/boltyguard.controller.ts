import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  PayloadTooLargeException,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import * as multer from 'multer';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { SkipCsrf } from '../../common/guards/csrf.guard';
import { RedisService } from '../../common/redis/redis.service';

import { BoltyGuardService } from './boltyguard.service';
import { BundleScanner } from './bundle-scanner';
import { GithubFetcher } from './github-fetcher';
import { FREE_TIER_DAILY_QUOTA, HolderGateService } from './holder-gate.service';

@Controller('boltyguard')
export class BoltyGuardController {
  constructor(
    private readonly guard: BoltyGuardService,
    private readonly holderGate: HolderGateService,
    private readonly redis: RedisService,
    private readonly bundle: BundleScanner,
    private readonly github: GithubFetcher,
  ) {}

  /** Public — anyone can read the latest score for any listing.
   *  Used by the launchpad ranking and the agent detail page badge.
   *  Cheap DB read, throttled lightly to discourage scraping. */
  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Get('listings/:id/latest')
  async latestForListing(@Param('id') listingId: string) {
    const scan = await this.guard.getLatest(listingId);
    if (!scan) return null;
    return {
      id: scan.id,
      score: scan.score,
      worstSeverity: scan.worstSeverity,
      summary: scan.summary,
      scanner: scan.scanner,
      scannedAt: scan.createdAt,
      findings: scan.findings,
    };
  }

  /** Trigger a fresh scan of a listing. Used by the publish flow and
   *  by sellers who updated their code. Heavier op — tighter throttle. */
  @Public()
  @SkipCsrf()
  @Throttle({ default: { limit: 6, ttl: 60_000 } })
  @Post('listings/:id/scan')
  @HttpCode(HttpStatus.OK)
  async rescanListing(@Param('id') listingId: string) {
    return this.guard.scanListing(listingId);
  }

  /** External scan-anything endpoint. Stateless, doesn't persist.
   *
   *  Tiering:
   *  - Anonymous / non-holder: limited to FREE_TIER_DAILY_QUOTA scans
   *    per day per user (or per IP fallback). Returns 403 once quota
   *    is exhausted with a hint to top up $BOLTY.
   *  - Holder of ≥ MIN_HOLDING $BOLTY (env): unlimited.
   *
   *  Holder check is read-only — we don't burn tokens. Holding alone
   *  unlocks the API.
   */
  @Public()
  @SkipCsrf()
  @Throttle({ default: { limit: 12, ttl: 60_000 } })
  @Post('scan')
  @HttpCode(HttpStatus.OK)
  async scanCode(
    @CurrentUser('id') userId: string | null,
    @Body() body: { code?: string; fileName?: string; isAgent?: boolean },
  ) {
    const code = String(body?.code || '').slice(0, 200_000);
    if (!code.trim()) throw new BadRequestException('code is required');

    const gate = await this.holderGate.isHolder(userId);
    if (!gate.holder) {
      const remaining = await this.consumeFreeQuota(userId ?? null);
      if (remaining < 0) {
        throw new ForbiddenException(
          `Free quota exhausted. Hold ≥ ${gate.minHolding} $BOLTY in a linked wallet to unlock unmetered scans (current balance: ${gate.balance}).`,
        );
      }
    }

    const report = await this.guard.scanCode(code, {
      fileName: body?.fileName,
      isAgent: body?.isAgent,
    });
    return {
      ...report,
      tier: gate.holder ? 'holder' : 'free',
      holding: gate.balance,
      minHolding: gate.minHolding,
    };
  }

  /**
   * Scan a ZIP bundle. Multipart upload, single field `file`. Hard-
   * capped at 5MB on the wire by multer; the BundleScanner then re-
   * validates the magic bytes, walks the entries with strict caps
   * (max 100 files, 500KB / file uncompressed, 10MB total, ratio
   * cap 200:1), drops anything with path traversal / symlinks /
   * banned extensions, and only scans whitelisted text formats.
   */
  @Public()
  @SkipCsrf()
  @Throttle({ default: { limit: 6, ttl: 60_000 } })
  @Post('scan-bundle')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: multer.memoryStorage(),
      limits: {
        fileSize: BundleScanner.MAX_ZIP_BYTES,
        files: 1,
        fields: 4,
      },
      fileFilter: (_req, file, cb) => {
        // Don't trust the mime — browsers send all sorts of values
        // for .zip (application/zip, x-zip-compressed, x-zip,
        // octet-stream, sometimes empty). The real defense is the
        // EOCD magic-byte sniff inside BundleScanner. Just check
        // the extension as a hint and let the scanner reject bad
        // bytes deeper in.
        const looksZip =
          /\.zip$/i.test(file.originalname || '') ||
          (file.mimetype || '').toLowerCase().includes('zip');
        if (!looksZip) {
          cb(new BadRequestException('upload a .zip file'), false);
          return;
        }
        cb(null, true);
      },
    }),
  )
  async scanBundle(
    @CurrentUser('id') userId: string | null,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body('isAgent') isAgentRaw?: string,
  ) {
    if (!file?.buffer?.length) {
      throw new BadRequestException('zip file is required');
    }
    if (file.size > BundleScanner.MAX_ZIP_BYTES) {
      throw new PayloadTooLargeException('zip exceeds 5MB cap');
    }

    const gate = await this.holderGate.isHolder(userId);
    if (!gate.holder) {
      const remaining = await this.consumeFreeQuota(userId ?? null);
      if (remaining < 0) {
        throw new ForbiddenException(
          `Free quota exhausted. Hold ≥ ${gate.minHolding} $BOLTY in a linked wallet to unlock unmetered scans (current balance: ${gate.balance}).`,
        );
      }
    }

    const isAgent = isAgentRaw === 'true' || isAgentRaw === '1';
    let result;
    try {
      result = await this.bundle.scanZip(file.buffer, { isAgent });
    } catch (err) {
      // Surface a useful 400 instead of a 500 stack trace. The
      // bundle scanner throws Errors with human-readable messages
      // ("not a zip", "too many entries", "aggregate uncompressed
      // size exceeds limit", etc).
      throw new BadRequestException((err as Error).message || 'failed to scan bundle');
    }
    return {
      ...result,
      tier: gate.holder ? 'holder' : 'free',
      holding: gate.balance,
      minHolding: gate.minHolding,
    };
  }

  /**
   * Scan a public GitHub repo. Body: { url: "owner/repo" or
   * "https://github.com/owner/repo[/tree/<ref>]", isAgent?: bool }.
   *
   * Server-side fetch via the GitHub REST API (zipball endpoint). We
   * never load arbitrary URLs the user supplies — only github.com /
   * codeload.github.com / objects.githubusercontent.com — and the
   * download is hard-capped at 5MB. The resulting buffer is handed
   * to BundleScanner which re-applies its own caps + path / symlink /
   * binary guards. Free quota counts the same as a single scan.
   */
  @Public()
  @SkipCsrf()
  @Throttle({ default: { limit: 4, ttl: 60_000 } })
  @Post('scan-repo')
  @HttpCode(HttpStatus.OK)
  async scanRepo(
    @CurrentUser('id') userId: string | null,
    @Body() body: { url?: string; isAgent?: boolean },
  ) {
    const spec = this.github.parseRepoSpec(String(body?.url || ''));
    if (!spec) {
      throw new BadRequestException('Provide a github.com URL or owner/repo (e.g. ar00ii/bolty).');
    }
    const gate = await this.holderGate.isHolder(userId);
    if (!gate.holder) {
      const remaining = await this.consumeFreeQuota(userId ?? null);
      if (remaining < 0) {
        throw new ForbiddenException(
          `Free quota exhausted. Hold ≥ ${gate.minHolding} $BOLTY in a linked wallet to unlock unmetered scans (current balance: ${gate.balance}).`,
        );
      }
    }
    let zipBuf: Buffer;
    try {
      zipBuf = await this.github.fetchZip(spec);
    } catch (err) {
      throw new BadRequestException((err as Error).message || 'failed to download repo');
    }
    const result = await this.bundle.scanZip(zipBuf, {
      isAgent: !!body?.isAgent,
    });
    return {
      ...result,
      source: { kind: 'github', owner: spec.owner, repo: spec.repo, ref: spec.ref ?? null },
      tier: gate.holder ? 'holder' : 'free',
      holding: gate.balance,
      minHolding: gate.minHolding,
    };
  }

  /** Decrement the per-user daily quota in Redis. Returns the count
   *  of remaining scans AFTER this call; -1 means already exhausted. */
  private async consumeFreeQuota(userId: string | null): Promise<number> {
    const bucket = userId ?? `anon-${new Date().toISOString().slice(0, 10)}`;
    const key = `boltyguard:freequota:${bucket}:${new Date().toISOString().slice(0, 10)}`;
    const used = await this.redis.incr(key);
    if (used === 1) {
      // Expire at end of day. 25h is fine — generous TTL avoids race.
      await this.redis.expire(key, 25 * 60 * 60);
    }
    return FREE_TIER_DAILY_QUOTA - used;
  }
}
