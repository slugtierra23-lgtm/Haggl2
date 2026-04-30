import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  Header,
  HttpCode,
  HttpStatus,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  Res,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { Response } from 'express';
import { diskStorage } from 'multer';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { isSafeUrl } from '../../common/sanitize/sanitize.util';
import { StepUpService } from '../auth/step-up.service';

import { AgentHealthService } from './agent-health.service';
import { AgentScanService } from './agent-scan.service';
import { ApiKeysService } from './api-keys.service';
import { MarketService } from './market.service';
import { NegotiationService } from './negotiation.service';

interface CreateListingBody {
  title: string;
  description: string;
  type: 'REPO' | 'BOT' | 'SCRIPT' | 'AI_AGENT' | 'OTHER';
  price: number;
  currency?: string;
  minPrice?: number;
  tags?: string[];
  repositoryId?: string;
  agentUrl?: string;
  agentEndpoint?: string;
  agentProtocol?: 'webhook' | 'mcp' | 'openai' | 'sandbox' | 'hybrid' | 'docker';
  agentModel?: string;
  agentApiKey?: string;
  fileKey?: string;
  fileName?: string;
  fileSize?: number;
  fileMimeType?: string;
  twoFactorCode?: string;
}

interface DeleteListingBody {
  twoFactorCode?: string;
}

interface PurchaseListingBody {
  txHash: string;
  amountWei: string;
  negotiationId?: string;
  platformFeeTxHash?: string;
  consentSignature?: string;
  consentMessage?: string;
  escrowContract?: string;
}

interface SendMessageBody {
  content: string;
  proposedPrice?: number;
}

const UPLOADS_DIR = path.join(process.cwd(), 'uploads', 'market');

const ALLOWED_MIMETYPES = new Set([
  'text/plain',
  'text/x-python',
  'text/javascript',
  'application/javascript',
  'text/typescript',
  'application/json',
  'application/zip',
  'application/x-zip-compressed',
  'application/x-zip',
  'text/x-yaml',
  'application/x-yaml',
  'text/yaml',
  'text/x-sh',
  'text/x-shellscript',
  'application/x-sh',
  'application/x-python',
  'text/markdown',
  'text/csv',
  'application/toml',
  'text/x-toml',
]);

// SVG files can contain embedded JavaScript — always reject them
const BLOCKED_MIMETYPES = new Set([
  'image/svg+xml',
  'text/svg',
  'application/svg',
  'application/svg+xml',
]);

/** Parse a comma-separated `ids` query param into a clean string array.
 *  Trims whitespace, dedupes, drops empties, caps at 100. Used by the
 *  batch lookup endpoint so the FE can collapse N favorite-fetches into
 *  one request. Cap is intentional — anything bigger should paginate. */
function parseIdList(raw: string | undefined): string[] {
  if (!raw) return [];
  const seen = new Set<string>();
  for (const part of raw.split(',')) {
    const id = part.trim();
    if (id) seen.add(id);
    if (seen.size >= 100) break;
  }
  return [...seen];
}

@UseGuards(JwtAuthGuard)
@Controller('market')
export class MarketController {
  constructor(
    private readonly marketService: MarketService,
    private readonly negotiationService: NegotiationService,
    private readonly agentScanService: AgentScanService,
    private readonly apiKeysService: ApiKeysService,
    private readonly agentHealth: AgentHealthService,
    private readonly stepUp: StepUpService,
  ) {}

  // ── API Keys ───────────────────────────────────────────────────────────────

  @Get('api-keys')
  getApiKeys(@CurrentUser('id') userId: string) {
    return this.apiKeysService.getUserApiKeys(userId);
  }

  @Post('api-keys')
  @HttpCode(HttpStatus.CREATED)
  createApiKey(@CurrentUser('id') userId: string, @Body() body: { label?: string | null }) {
    return this.apiKeysService.createApiKey(userId, body.label || null);
  }

  @Patch('api-keys/:id')
  renameApiKey(
    @Param('id') keyId: string,
    @CurrentUser('id') userId: string,
    @Body() body: { label?: string | null },
  ) {
    return this.apiKeysService.renameApiKey(userId, keyId, body.label ?? null);
  }

  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @Post('api-keys/:id/request-delete-verification')
  requestDeleteVerification(
    @Param('id') keyId: string,
    @CurrentUser('id') userId: string,
    @CurrentUser('email') userEmail: string,
  ) {
    return this.apiKeysService.requestDeleteVerification(userId, keyId, userEmail);
  }

  // Brute-forcing a 6-digit code is only 10^6 guesses — throttle aggressively
  // so an attacker with a hijacked session can't exhaust the keyspace.
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Delete('api-keys/:id')
  @HttpCode(HttpStatus.OK)
  async deleteApiKey(
    @Param('id') keyId: string,
    @CurrentUser('id') userId: string,
    @Body() body: { twoFactorCode?: string },
  ) {
    // Gate behind TOTP step-up so a hijacked session can't silently revoke
    // keys. No-op when 2FA is disabled on the account.
    await this.stepUp.assert(userId, body?.twoFactorCode);
    return this.apiKeysService.deleteApiKey(keyId, userId);
  }

  // ── Listings ───────────────────────────────────────────────────────────────

  @Public()
  // Public list — serve from edge for 5 min, and keep stale-while-
  // revalidate at 10 min so a GH Actions cache-warm cron that runs
  // every 5 min keeps users on warm responses while a background
  // revalidation tops up the edge. 30s was too tight: a cron that
  // misses a run by 5s would drop every user onto a cold origin.
  @Header('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600')
  @Get()
  getListings(
    @Query('type') type?: string,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('sortBy') sortBy?: string,
    @Query('minPrice') minPrice?: string,
    @Query('maxPrice') maxPrice?: string,
    @Query('tags') tags?: string,
    @Query('hasDemo') hasDemo?: string,
  ) {
    const allowed = ['recent', 'trending', 'price-low', 'price-high'] as const;
    const normalizedSort = allowed.includes(sortBy as (typeof allowed)[number])
      ? (sortBy as (typeof allowed)[number])
      : 'recent';
    const parsedMin = minPrice && !Number.isNaN(Number(minPrice)) ? Number(minPrice) : undefined;
    const parsedMax = maxPrice && !Number.isNaN(Number(maxPrice)) ? Number(maxPrice) : undefined;
    const parsedTags = tags
      ? tags
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean)
          .slice(0, 10)
      : undefined;
    return this.marketService.getListings({
      type,
      search,
      page: page ? Number(page) : 1,
      sortBy: normalizedSort,
      minPrice: parsedMin,
      maxPrice: parsedMax,
      tags: parsedTags,
      hasDemo: hasDemo === '1' || hasDemo === 'true',
    });
  }

  @Public()
  @Get('facets')
  getFacets() {
    return this.marketService.getListingFacets();
  }

  @Public()
  @Header('Cache-Control', 'public, s-maxage=20, stale-while-revalidate=60')
  @Get('pulse')
  getPulse(@Query('limit') limit?: string) {
    const parsed = limit && !Number.isNaN(Number(limit)) ? Number(limit) : 15;
    const bounded = Math.min(50, Math.max(1, parsed));
    return this.marketService.getMarketPulse(bounded);
  }

  @Public()
  @Header('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=120')
  @Get('top-sellers')
  getTopSellers(@Query('limit') limit?: string) {
    const parsed = limit && !Number.isNaN(Number(limit)) ? Number(limit) : 12;
    const bounded = Math.min(48, Math.max(1, parsed));
    return this.marketService.getTopSellers(bounded);
  }

  @Public()
  @Header('Cache-Control', 'public, s-maxage=10, stale-while-revalidate=30')
  @Get('ticker')
  getTicker() {
    return this.marketService.getTickerSnapshot();
  }

  @Public()
  @Header('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=120')
  @Get('leaderboard')
  getLeaderboard() {
    return this.marketService.getLeaderboard();
  }

  @Public()
  @Get('boost-pricing')
  getBoostPricing() {
    return this.marketService.getBoostPricing();
  }

  @Post(':id/boost')
  boostListing(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @Body() body: { durationDays?: number; amountTokens?: number; txHash?: string },
  ) {
    return this.marketService.boostListing(id, userId, body || {});
  }

  // Must be defined before :id to avoid route clash
  // Protected: only users who purchased the listing can download
  @Get('files/:key')
  async serveFile(
    @Param('key') key: string,
    @CurrentUser('id') userId: string,
    @Res() res: Response,
  ) {
    if (!/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/.test(key)) {
      throw new NotFoundException();
    }
    const filePath = path.join(UPLOADS_DIR, key);
    // Ensure resolved path stays within uploads directory (path traversal protection)
    if (!path.resolve(filePath).startsWith(path.resolve(UPLOADS_DIR))) {
      throw new NotFoundException();
    }
    if (!fs.existsSync(filePath)) throw new NotFoundException('File not found');
    const meta = await this.marketService.getListingByFileKey(key);
    if (!meta) throw new NotFoundException('Listing not found');

    // Security: Verify user purchased this listing before allowing download
    const hasPurchased = await this.marketService.userHasPurchasedListing(meta.id, userId);
    if (!hasPurchased) {
      throw new ForbiddenException(
        'You do not have access to this file. Purchase the listing first.',
      );
    }

    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${(meta.fileName || key).replace(/"/g, '_')}"`,
    );
    // nosniff + neutral MIME stops browsers from rendering uploaded text
    // payloads as HTML/JS on the API origin.
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    const unsafeServed =
      /^(text\/html|application\/xhtml\+xml|text\/xml|application\/xml|image\/svg\+xml)/i;
    const serveType =
      meta.fileMimeType && !unsafeServed.test(meta.fileMimeType)
        ? meta.fileMimeType
        : 'application/octet-stream';
    res.setHeader('Content-Type', serveType);
    res.sendFile(filePath);
  }

  @Get('negotiations')
  getMyNegotiations(@CurrentUser('id') userId: string) {
    return this.negotiationService.getMyNegotiations(userId);
  }

  /**
   * Ownership check used by the listing detail page to hide the Buy
   * button (and swap it for "Open in Inventory") BEFORE the user clicks
   * and opens MetaMask. Without this the user can pay twice for an
   * item they already own — the backend rejects on the second purchase
   * but the ETH has already left their wallet.
   */
  @Get(':id/purchased')
  checkPurchased(@Param('id') id: string, @CurrentUser('id') userId: string) {
    return this.marketService.getPurchaseStatus(id, userId);
  }

  @Get('negotiations/:id')
  getNegotiation(@Param('id') id: string, @CurrentUser('id') userId: string) {
    return this.negotiationService.getNegotiation(id, userId);
  }

  @Get('seller/analytics')
  getSellerAnalytics(@CurrentUser('id') userId: string) {
    return this.marketService.getSellerAnalytics(userId);
  }

  @Get('library')
  getMyLibrary(@CurrentUser('id') userId: string) {
    return this.marketService.getMyLibrary(userId);
  }

  /**
   * Seller-scoped feed used by /market/agents → "My agents" tab so freshly
   * published drafts appear even while they're still in PENDING_REVIEW.
   * The public GET /market feed only returns ACTIVE listings, so without
   * this endpoint sellers couldn't see their own pending work.
   */
  @Get('my-listings')
  getMyListings(@CurrentUser('id') userId: string) {
    return this.marketService.getMyListings(userId);
  }

  /**
   * Unified inventory endpoint: everything the user has published (repos +
   * listings) plus everything they've bought (repo purchases + market
   * purchases) plus their recent reputation events. Powers the /inventory
   * page.
   */
  @Get('my-inventory')
  getMyInventory(@CurrentUser('id') userId: string) {
    return this.marketService.getMyInventory(userId);
  }

  @Public()
  @Get('sellers/:username')
  getSellerProfile(@Param('username') username: string) {
    return this.marketService.getSellerProfile(username);
  }

  /** Bulk lookup. Used by the favorites page and the library "saved"
   *  tab so they don't fan out into N parallel `GET /market/:id`
   *  requests when the user has multiple bookmarks. Capped at 100
   *  ids per call to keep the URL short and the payload bounded;
   *  the FE chunks above that. Public — same access rules as
   *  `GET /market/:id`, which is also Public. */
  @Public()
  @Get('by-ids')
  getListingsByIds(@Query('ids') ids?: string) {
    return this.marketService.getListingsByIds(parseIdList(ids));
  }

  @Public()
  @Get(':id')
  getListing(@Param('id') id: string) {
    return this.marketService.getListing(id);
  }

  @Public()
  @Get(':id/related')
  getRelated(@Param('id') id: string) {
    return this.marketService.getRelatedListings(id);
  }

  /** On-demand ping of an AI agent's webhook. Used by the launch
   *  wizard to gate the "AI-launch" toggle and by the agent detail
   *  page to hide buy/try buttons when the agent is offline. */
  @Public()
  @Throttle({ default: { limit: 12, ttl: 60_000 } })
  @Get(':id/health')
  checkListingHealth(@Param('id') id: string) {
    return this.agentHealth.checkListing(id);
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post(':id/invoke')
  @HttpCode(HttpStatus.OK)
  invokeAgent(@Param('id') id: string, @Body() body: { prompt: string }) {
    return this.marketService.invokeAgent(id, body?.prompt || '');
  }

  // ── Reviews ────────────────────────────────────────────────────────────────

  @Public()
  @Get(':id/reviews')
  getReviews(@Param('id') id: string) {
    return this.marketService.getReviews(id);
  }

  @Post(':id/reviews')
  @HttpCode(HttpStatus.CREATED)
  createReview(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @Body() body: { rating: number; content?: string | null },
  ) {
    return this.marketService.createReview(id, userId, body?.rating, body?.content);
  }

  @Delete('reviews/:reviewId')
  @HttpCode(HttpStatus.OK)
  deleteReview(@Param('reviewId') reviewId: string, @CurrentUser('id') userId: string) {
    return this.marketService.deleteReview(reviewId, userId);
  }

  // ── Create / delete listings ───────────────────────────────────────────────

  @Post('upload')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: (_req, _file, cb) => {
          fs.mkdirSync(UPLOADS_DIR, { recursive: true });
          cb(null, UPLOADS_DIR);
        },
        filename: (_req, _file, cb) => cb(null, crypto.randomUUID()),
      }),
      limits: { fileSize: 10 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        // Reject explicitly blocked MIME types (SVG, etc.)
        if (BLOCKED_MIMETYPES.has(file.mimetype)) {
          cb(new BadRequestException(`File type not allowed: ${file.mimetype}`), false);
          return;
        }

        // Reject renderable extensions regardless of declared MIME —
        // browsers sniff HTML/XHTML even when Content-Type says otherwise.
        const ext = path.extname(file.originalname).toLowerCase();
        const blockedExts = new Set(['.svg', '.html', '.htm', '.xhtml', '.xml', '.xsl', '.xslt']);
        if (blockedExts.has(ext)) {
          cb(new BadRequestException(`File extension not allowed: ${ext} (security risk)`), false);
          return;
        }

        // Reject renderable MIME types that slip through text/* — these
        // execute inline scripts when the browser ignores attachment.
        const mt = file.mimetype.toLowerCase();
        if (
          mt === 'text/html' ||
          mt === 'application/xhtml+xml' ||
          mt === 'text/xml' ||
          mt === 'application/xml'
        ) {
          cb(new BadRequestException(`File type not allowed: ${file.mimetype}`), false);
          return;
        }

        // Allow explicitly whitelisted MIME types or any text/* type (safe for text editors)
        if (ALLOWED_MIMETYPES.has(file.mimetype) || file.mimetype.startsWith('text/')) {
          cb(null, true);
        } else {
          cb(new BadRequestException(`File type not allowed: ${file.mimetype}`), false);
        }
      },
    }),
  )
  async uploadFile(@CurrentUser('id') _userId: string, @UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('No file received');
    const scan = await this.agentScanService.scan(file.filename, file.originalname);
    return {
      fileKey: file.filename,
      fileName: file.originalname,
      fileSize: file.size,
      fileMimeType: file.mimetype,
      scanPassed: scan.passed,
      scanNote: scan.note,
    };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createListing(@CurrentUser('id') userId: string, @Body() body: CreateListingBody) {
    // Validate agentEndpoint if provided
    if (body.agentEndpoint && !isSafeUrl(body.agentEndpoint)) {
      throw new BadRequestException('Invalid or unsafe agent endpoint URL');
    }
    const { twoFactorCode: _drop, ...payload } = body;
    return this.marketService.createListing(userId, payload);
  }

  @Post(':id/claim-free')
  @HttpCode(HttpStatus.CREATED)
  claimFreeListing(@Param('id') id: string, @CurrentUser('id') buyerId: string) {
    return this.marketService.claimFreeListing(id, buyerId);
  }

  @Post(':id/purchase')
  @Throttle({ default: { limit: 20, ttl: 3600000 } })
  @HttpCode(HttpStatus.CREATED)
  purchaseListing(
    @Param('id') id: string,
    @CurrentUser('id') buyerId: string,
    @Body() body: PurchaseListingBody,
  ) {
    if (!body.txHash?.trim()) throw new BadRequestException('txHash required');
    return this.marketService.purchaseListing(
      id,
      buyerId,
      body.txHash,
      body.amountWei || '0',
      body.negotiationId,
      body.platformFeeTxHash,
      body.consentSignature,
      body.consentMessage,
      body.escrowContract,
    );
  }

  /**
   * Recovery for listing purchases whose on-chain payment landed but
   * /market/:id/purchase never returned success. Requires the buyer's
   * JWT + listingId + txHash; re-runs the same verification pipeline.
   */
  @Post(':id/recover-purchase')
  @Throttle({ default: { limit: 20, ttl: 3600000 } })
  @HttpCode(HttpStatus.OK)
  recoverListingPurchase(
    @Param('id') id: string,
    @CurrentUser('id') buyerId: string,
    @Body() body: { txHash?: string; negotiationId?: string },
  ) {
    if (!body.txHash?.trim()) throw new BadRequestException('txHash required');
    return this.marketService.recoverListingPurchase(
      buyerId,
      id,
      body.txHash.trim(),
      body.negotiationId,
    );
  }

  /**
   * Listing-agnostic recovery: given only a txHash, look up the seller
   * on-chain and match the paid amount to one of their listings. Used
   * by the /inventory recovery widget when the user doesn't know which
   * listing the tx was for.
   */
  @Post('recover-purchase')
  @Throttle({ default: { limit: 20, ttl: 3600000 } })
  @HttpCode(HttpStatus.OK)
  recoverListingPurchaseByTx(
    @CurrentUser('id') buyerId: string,
    @Body() body: { txHash?: string },
  ) {
    if (!body.txHash?.trim()) throw new BadRequestException('txHash required');
    return this.marketService.recoverListingPurchaseByTx(buyerId, body.txHash.trim());
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteListing(@Param('id') id: string, @CurrentUser('id') userId: string) {
    await this.marketService.deleteListing(id, userId);
  }

  // ── Negotiations ───────────────────────────────────────────────────────────

  @Post(':listingId/negotiate')
  startNegotiation(
    @Param('listingId') listingId: string,
    @CurrentUser('id') buyerId: string,
    @Body() body: { buyerAgentListingId?: string } = {},
  ) {
    // Agent-to-agent negotiation is enabled by default. Set
    // NEGOTIATION_DISABLED=1 to force-disable (e.g. during outages).
    if (process.env.NEGOTIATION_DISABLED === '1') {
      throw new BadRequestException(
        'Negotiation is temporarily paused — try again in a few minutes.',
      );
    }
    return this.negotiationService.startNegotiation(buyerId, listingId, body.buyerAgentListingId);
  }

  @Post('negotiations/:id/message')
  sendMessage(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @Body() body: SendMessageBody,
  ) {
    if (!body.content?.trim()) throw new BadRequestException('Message content required');
    return this.negotiationService.sendMessage(id, userId, body.content, body.proposedPrice);
  }

  @Post('negotiations/:id/accept')
  acceptDeal(@Param('id') id: string, @CurrentUser('id') userId: string) {
    return this.negotiationService.acceptDeal(id, userId);
  }

  @Post('negotiations/:id/reject')
  @HttpCode(HttpStatus.OK)
  rejectDeal(@Param('id') id: string, @CurrentUser('id') userId: string) {
    return this.negotiationService.rejectDeal(id, userId);
  }

  /**
   * Counter-offer: the user declined the current AGREED price and
   * sends a new proposal. Flips the negotiation back to ACTIVE, posts
   * the message + price on behalf of the user's role, and kicks the
   * AI loop back on for the counterparty to respond.
   */
  @Post('negotiations/:id/counter')
  @HttpCode(HttpStatus.OK)
  counterOffer(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @Body() body: { content?: string; proposedPrice?: number },
  ) {
    return this.negotiationService.counterOffer(
      id,
      userId,
      body.content?.trim() || 'Not quite — how about this instead?',
      body.proposedPrice,
    );
  }

  /**
   * Request switching from AI-vs-AI to human negotiation.
   * The other party must call /accept-human to confirm (Pokemon trade handshake).
   */
  @Post('negotiations/:id/request-human')
  requestHumanSwitch(@Param('id') id: string, @CurrentUser('id') userId: string) {
    return this.negotiationService.requestHumanSwitch(id, userId);
  }

  /**
   * Accept the pending human-mode switch request from the other party.
   * Once accepted, both users can type freely.
   */
  @Post('negotiations/:id/accept-human')
  acceptHumanSwitch(@Param('id') id: string, @CurrentUser('id') userId: string) {
    return this.negotiationService.acceptHumanSwitch(id, userId);
  }
}
