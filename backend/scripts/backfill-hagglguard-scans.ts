/**
 * One-shot script: scan every existing AI_AGENT / BOT marketplace
 * listing through HagglGuard so the badges on the marketplace +
 * agent detail pages stop showing "Unscanned" for legacy data.
 *
 * Usage (from backend/):
 *
 *   # In production — runs against the live DB. Anthropic key required.
 *   ANTHROPIC_API_KEY=sk-... npx ts-node scripts/backfill-hagglguard-scans.ts
 *
 *   # Add LIMIT=10 to cap the run for testing.
 *   # Add ONLY_MISSING=1 to skip listings that already have a scan.
 *
 * The script bootstraps a NestJS application context so it can reuse
 * HagglGuardService directly — same code path as the publish flow.
 * Listings without a fileKey produce score 100 and are still recorded
 * so the UI doesn't keep showing them as "Unscanned".
 */

import { NestFactory } from '@nestjs/core';

import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { HagglGuardService } from '../src/modules/hagglguard/hagglguard.service';

async function main() {
  const limit = Number(process.env.LIMIT) || Infinity;
  const onlyMissing = process.env.ONLY_MISSING === '1';

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  const prisma = app.get(PrismaService);
  const guard = app.get(HagglGuardService);

  const listings = await prisma.marketListing.findMany({
    where: {
      type: { in: ['AI_AGENT', 'BOT'] },
      status: { in: ['ACTIVE', 'REMOVED'] },
    },
    select: { id: true, title: true, fileKey: true },
    orderBy: { createdAt: 'desc' },
  });

  console.log(`[backfill] ${listings.length} candidate listings`);

  let scanned = 0;
  let skipped = 0;
  let failed = 0;

  for (const l of listings) {
    if (scanned >= limit) break;

    if (onlyMissing) {
      const existing = await prisma.securityScan.findFirst({
        where: { listingId: l.id },
        select: { id: true },
      });
      if (existing) {
        skipped++;
        continue;
      }
    }

    process.stdout.write(`[backfill] ${l.id} · ${l.title.slice(0, 40)} … `);
    try {
      const r = await guard.scanListing(l.id);
      console.log(`score ${r.score} (${r.findings.length} findings, ${r.scanner})`);
      scanned++;
    } catch (err) {
      failed++;
      console.log(`FAILED: ${(err as Error).message}`);
    }
    // Tiny pause to avoid hammering the LLM API in a tight loop.
    await new Promise((r) => setTimeout(r, 250));
  }

  console.log(
    `[backfill] done. scanned=${scanned} skipped=${skipped} failed=${failed}`,
  );
  await app.close();
}

main().catch((err) => {
  console.error('[backfill] crashed:', err);
  process.exit(1);
});
