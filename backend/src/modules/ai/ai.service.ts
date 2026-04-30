import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from '@google/generative-ai';
import { Injectable, Logger, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Response } from 'express';

import { PrismaService } from '../../common/prisma/prisma.service';
import { RedisService } from '../../common/redis/redis.service';
import { sanitizeAiPrompt } from '../../common/sanitize/sanitize.util';

const SYSTEM_PROMPT = `You are haggl AI, an assistant for the haggl agents marketplace on Solana.
You help users with questions about crypto, DeFi, blockchain technology, and the haggl ecosystem.
You are professional, concise, and helpful.
You do NOT provide financial advice or price predictions.
You do NOT help with anything illegal or harmful.
Keep responses focused and relevant.`;

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private readonly genAI: GoogleGenerativeAI;

  // Per-user rate limiting
  private readonly AI_RATE_LIMIT = 10; // messages per window
  private readonly AI_RATE_WINDOW = 60; // seconds

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {
    const apiKey = this.config.get<string>('GEMINI_API_KEY');
    if (!apiKey) {
      this.logger.error('GEMINI_API_KEY is not configured');
    }
    this.genAI = new GoogleGenerativeAI(apiKey || '');
  }

  async streamChat(
    userId: string,
    sessionId: string,
    userMessage: string,
    res: Response,
  ): Promise<void> {
    // ── Rate limiting ─────────────────────────────────────────────────────
    const rateKey = `ai_rate:${userId}`;
    const count = await this.redis.incr(rateKey);
    if (count === 1) {
      await this.redis.expire(rateKey, this.AI_RATE_WINDOW);
    }
    if (count > this.AI_RATE_LIMIT) {
      const ttl = await this.redis.ttl(rateKey);
      throw new ForbiddenException(`AI rate limit exceeded. Try again in ${ttl}s`);
    }

    // ── Sanitize input ────────────────────────────────────────────────────
    const sanitized = sanitizeAiPrompt(userMessage);
    if (!sanitized || sanitized.length < 1) {
      throw new ForbiddenException('Invalid message');
    }

    // ── Get session history ───────────────────────────────────────────────
    const session = await this.prisma.aiSession.findFirst({
      where: { id: sessionId, userId },
      include: {
        messages: {
          orderBy: { createdAt: 'asc' },
          take: 20, // Keep last 20 messages as context
        },
      },
    });

    // ── Save user message ─────────────────────────────────────────────────
    await this.prisma.aiMessage.create({
      data: {
        role: 'USER',
        content: sanitized,
        sessionId,
      },
    });

    // ── Build history for Gemini ──────────────────────────────────────────
    const history = (session?.messages || []).map((msg) => ({
      role: msg.role === 'USER' ? 'user' : 'model',
      parts: [{ text: msg.content }],
    }));

    // ── Call Gemini ───────────────────────────────────────────────────────
    const model = this.genAI.getGenerativeModel({
      model: 'gemini-2.0-flash',
      systemInstruction: SYSTEM_PROMPT,
      safetySettings: [
        {
          category: HarmCategory.HARM_CATEGORY_HARASSMENT,
          threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
        },
        {
          category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
          threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
        },
        {
          category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
          threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
        },
        {
          category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
          threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
        },
      ],
    });

    const chat = model.startChat({ history });

    // Set streaming headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    let fullResponse = '';

    try {
      const result = await chat.sendMessageStream(sanitized);

      for await (const chunk of result.stream) {
        const text = chunk.text();
        if (text) {
          fullResponse += text;
          res.write(`data: ${JSON.stringify({ chunk: text })}\n\n`);
        }
      }

      // Save assistant response
      await this.prisma.aiMessage.create({
        data: {
          role: 'ASSISTANT',
          content: fullResponse,
          sessionId,
        },
      });

      // Audit log
      await this.prisma.auditLog.create({
        data: {
          action: 'AI_CHAT',
          resource: 'AI_SESSION',
          resourceId: sessionId,
          userId,
          metadata: { messageLength: sanitized.length },
        },
      });

      res.write('data: [DONE]\n\n');
      res.end();
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Gemini API error: ${errMsg}`);
      res.write(`data: ${JSON.stringify({ error: 'AI service temporarily unavailable' })}\n\n`);
      res.end();
    }
  }

  async createSession(userId: string): Promise<{ sessionId: string }> {
    const session = await this.prisma.aiSession.create({
      data: { userId },
    });
    return { sessionId: session.id };
  }

  async getSessions(userId: string) {
    return this.prisma.aiSession.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 20,
      include: {
        messages: {
          orderBy: { createdAt: 'asc' },
          take: 1,
        },
        _count: { select: { messages: true } },
      },
    });
  }

  async getSession(sessionId: string, userId: string) {
    const session = await this.prisma.aiSession.findFirst({
      where: { id: sessionId, userId },
      include: {
        messages: {
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!session) throw new ForbiddenException('Session not found');
    return session;
  }
}
