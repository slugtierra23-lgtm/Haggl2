import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import type { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';

import { AppModule } from './app.module';
import { WinstonLogger } from './common/logger/winston.logger';

// API Key generation fix - rebuild trigger

const REQUIRED_ENV_VARS = ['JWT_SECRET', 'DATABASE_URL', 'FRONTEND_URL', 'REDIS_URL'];

async function bootstrap(): Promise<void> {
  const missing = REQUIRED_ENV_VARS.filter((v) => !process.env[v]);
  if (missing.length > 0) {
    // eslint-disable-next-line no-console
    console.error(`[Bootstrap] Missing required environment variables: ${missing.join(', ')}`);
    process.exit(1);
  }

  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
  });

  const configService = app.get(ConfigService);
  const logger = new WinstonLogger();
  app.useLogger(logger);

  const frontendUrl = configService.get<string>('FRONTEND_URL', 'http://localhost:3000');
  const port = parseInt(String(process.env.PORT || configService.get('PORT', '3001')), 10);

  // ── CORS (must be first!) ────────────────────────────────────────────────
  const allowedOrigins = configService
    .get<string>('CORS_ORIGINS', frontendUrl)
    .split(',')
    .map((o) => o.trim());

  app.enableCors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error(`CORS blocked origin: ${origin}`));
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token', 'X-Agent-Key'],
    optionsSuccessStatus: 200,
    preflightContinue: false,
  });

  // ── Security Headers ─────────────────────────────────────────────────────
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:', 'https:'],
          connectSrc: ["'self'", ...allowedOrigins],
          fontSrc: ["'self'"],
          objectSrc: ["'none'"],
          mediaSrc: ["'none'"],
          frameSrc: ["'none'"],
          frameAncestors: ["'none'"],
        },
      },
      crossOriginEmbedderPolicy: false,
    }),
  );

  // ── Cookie Parser ────────────────────────────────────────────────────────
  app.use(cookieParser(configService.get<string>('SESSION_SECRET')));

  // ── Prevent CDN/proxy caching of authenticated responses ─────────────────
  // Without this, CloudFlare or any shared proxy can cache /auth/me, /users/profile,
  // /notifications and similar endpoints, causing every visitor to see the same user.
  app.use((req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Vary', 'Cookie, Authorization');
    next();
  });

  // ── Global Validation Pipe ───────────────────────────────────────────────
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // strip unknown properties
      forbidNonWhitelisted: true, // throw on unknown properties
      transform: true, // auto-transform payloads
      disableErrorMessages: configService.get('NODE_ENV') === 'production',
      validationError: { target: false },
      skipMissingProperties: false,
    }),
  );

  // ── API Prefix ───────────────────────────────────────────────────────────
  app.setGlobalPrefix('api/v1');

  await app.listen(port, '0.0.0.0');
  logger.log(`haggl Backend running on port ${port}`, 'Bootstrap');
  logger.log(`Environment: ${configService.get('NODE_ENV')}`, 'Bootstrap');
}

bootstrap();
