import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { IsString, Length } from 'class-validator';
import { Response } from 'express';
import { diskStorage } from 'multer';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PrismaService } from '../../common/prisma/prisma.service';

import { ChatService, FEED_CHANNELS } from './chat.service';

class ReportDto {
  @IsString()
  @Length(5, 500)
  reason!: string;
}

const UPLOADS_DIR = path.join(process.cwd(), 'uploads', 'chat');
// Only accept image payloads — the feed composer doesn't need anything else.
// SVG is intentionally excluded (can carry inline JS); raster-only is safer.
const ALLOWED_IMAGE_MIMES = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/gif',
  'image/webp',
]);

@Controller('chat')
@UseGuards(JwtAuthGuard)
export class ChatController {
  constructor(
    private readonly chatService: ChatService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('channels')
  getChannels() {
    return { channels: FEED_CHANNELS };
  }

  /**
   * Post a launchpad announcement to the `agents` channel on behalf of
   * the caller. Used by the launch wizard's "AI-launch" mode so the
   * token's debut shows up in the community feed without the creator
   * having to type anything. Body is auto-formatted from the payload.
   */
  @Post('announce-launch')
  @HttpCode(HttpStatus.OK)
  async announceLaunch(
    @CurrentUser('id') userId: string,
    @Body()
    body: {
      tokenAddress: string;
      symbol: string;
      name: string;
      listingId?: string;
    },
  ) {
    const addr = (body?.tokenAddress || '').trim();
    if (!/^0x[0-9a-fA-F]{40}$/.test(addr)) {
      throw new ForbiddenException('Invalid token address');
    }
    const symbol = (body?.symbol || '')
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
      .slice(0, 8);
    const name = (body?.name || '').slice(0, 40);
    const short = `${addr.slice(0, 6)}…${addr.slice(-4)}`;
    const content =
      `🚀 New launch: ${name} ($${symbol}).\n` +
      `Trade it on /launchpad/${addr}\n` +
      `CA: ${short}`;
    const message = await this.chatService.validateAndSave(userId, content, {
      channel: 'agents',
      viaAgentListingId: body?.listingId,
    });
    return message;
  }

  @Get('messages')
  async getMessages(
    @CurrentUser('id') userId: string,
    @Query('limit') limit?: string,
    @Query('channel') channel?: string,
  ) {
    const parsedLimit = Math.min(parseInt(limit || '50', 10) || 50, 100);
    const messages = await this.chatService.getRecentMessages(parsedLimit, undefined, channel);
    const liked = await this.chatService.likedMessageIds(
      messages.map((m) => m.id),
      userId,
    );
    return messages.map((m) => ({ ...m, likedByMe: liked.has(m.id) }));
  }

  /**
   * List the caller's own AI_AGENT market listings — used by the
   * /feed composer's "Connect an agent" picker so a seller can post
   * on behalf of one of their agents. Returns title + id only.
   */
  @Get('my-agents')
  async myAgents(@CurrentUser('id') userId: string) {
    const rows = await this.prisma.marketListing.findMany({
      where: { sellerId: userId, type: 'AI_AGENT' },
      select: { id: true, title: true, status: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return rows;
  }

  @Throttle({ default: { limit: 3, ttl: 60000 } })
  @Post('messages/:id/report')
  reportMessage(
    @Param('id') messageId: string,
    @Body() dto: ReportDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.chatService.reportMessage(messageId, userId, dto.reason);
  }

  @Throttle({ default: { limit: 60, ttl: 60000 } })
  @Post('messages/:id/like')
  @HttpCode(HttpStatus.OK)
  toggleLike(@Param('id') messageId: string, @CurrentUser('id') userId: string) {
    return this.chatService.toggleLike(messageId, userId);
  }

  // ── Image uploads for the feed composer ────────────────────────────────
  //
  // Separate from the /market/upload flow because market uploads are gated
  // behind purchases; feed images are just shared community content.

  @Throttle({ default: { limit: 20, ttl: 3600000 } })
  @Post('upload-image')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: (_req, _file, cb) => {
          fs.mkdirSync(UPLOADS_DIR, { recursive: true });
          cb(null, UPLOADS_DIR);
        },
        filename: (_req, file, cb) => {
          const ext = path.extname(file.originalname).toLowerCase();
          cb(null, `${crypto.randomUUID()}${ext}`);
        },
      }),
      limits: { fileSize: 5 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        if (!ALLOWED_IMAGE_MIMES.has(file.mimetype.toLowerCase())) {
          cb(new BadRequestException(`Image type not allowed: ${file.mimetype}`), false);
          return;
        }
        const ext = path.extname(file.originalname).toLowerCase();
        if (ext === '.svg' || ext === '.svgz') {
          cb(new BadRequestException('SVG is not allowed'), false);
          return;
        }
        cb(null, true);
      },
    }),
  )
  async uploadImage(@UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('No file received');
    return {
      url: `/chat/images/${file.filename}`,
      fileKey: file.filename,
      fileName: file.originalname,
      fileSize: file.size,
      fileMimeType: file.mimetype,
    };
  }

  /**
   * Serve an uploaded feed image. Public so unauth visitors who stumble
   * into a shared URL still render the image, but always with nosniff +
   * a locked-down CSP so even a mis-classified file can't execute.
   */
  @Public()
  @Get('images/:key')
  async serveImage(@Param('key') key: string, @Res() res: Response) {
    if (!/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}\.[a-z]+$/i.test(key)) {
      throw new NotFoundException();
    }
    const filePath = path.join(UPLOADS_DIR, key);
    if (!path.resolve(filePath).startsWith(path.resolve(UPLOADS_DIR))) {
      throw new ForbiddenException();
    }
    if (!fs.existsSync(filePath)) throw new NotFoundException('Image not found');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    // Long cache — filenames are UUIDs so contents never change under a key.
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.sendFile(filePath);
  }
}
