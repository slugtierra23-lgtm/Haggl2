import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD, APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { ThrottlerGuard } from '@nestjs/throttler';

import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { CsrfGuard } from './common/guards/csrf.guard';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { PrismaModule } from './common/prisma/prisma.module';
import { RedisModule } from './common/redis/redis.module';
import { AgentsModule } from './modules/agents/agents.module';
import { AiModule } from './modules/ai/ai.module';
import { AuthModule } from './modules/auth/auth.module';
import { StepUpModule } from './modules/auth/step-up.module';
import { BoltyGuardModule } from './modules/boltyguard/boltyguard.module';
import { CacheWarmerModule } from './modules/cache-warmer/cache-warmer.module';
import { ChartModule } from './modules/chart/chart.module';
import { ChatModule } from './modules/chat/chat.module';
import { DmModule } from './modules/dm/dm.module';
import { EscrowModule } from './modules/escrow/escrow.module';
import { HealthModule } from './modules/health/health.module';
import { MarketModule } from './modules/market/market.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { OrdersModule } from './modules/orders/orders.module';
import { RaysModule } from './modules/rays/rays.module';
import { ReposModule } from './modules/repos/repos.module';
import { ReputationModule } from './modules/reputation/reputation.module';
import { SeedModule } from './modules/seed/seed.module';
import { ServicesModule } from './modules/services/services.module';
import { SocialModule } from './modules/social/social.module';
import { TokenModule } from './modules/token/token.module';
import { UsersModule } from './modules/users/users.module';

@Module({
  imports: [
    // ── Config ──────────────────────────────────────────────────────────
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
      cache: true,
    }),

    // ── Rate Limiting (in-memory) ────────────────────────────────────────
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        throttlers: [
          {
            name: 'global',
            ttl: config.get<number>('RATE_LIMIT_WINDOW_MS', 900000),
            limit: config.get<number>('RATE_LIMIT_MAX_REQUESTS', 100),
          },
        ],
      }),
    }),

    // ── Core Modules ─────────────────────────────────────────────────────
    PrismaModule,
    RedisModule,

    // ── Feature Modules ───────────────────────────────────────────────────
    AgentsModule,
    RaysModule,
    AuthModule,
    StepUpModule,
    ChatModule,
    AiModule,
    SocialModule,
    ReposModule,
    ChartModule,
    UsersModule,
    DmModule,
    EscrowModule,
    HealthModule,
    MarketModule,
    BoltyGuardModule,
    NotificationsModule,
    OrdersModule,
    ReputationModule,
    ServicesModule,
    TokenModule,
    CacheWarmerModule,
    SeedModule,
  ],
  providers: [
    // Global CSRF protection guard (double-submit cookie pattern).
    // Registered BEFORE JwtAuthGuard so that unauthenticated GETs still
    // emit a fresh CSRF cookie — otherwise the first login POST has no
    // cookie to read and the guard rejects it with 403.
    {
      provide: APP_GUARD,
      useClass: CsrfGuard,
    },
    // Global JWT authentication guard (default: all routes require auth, use @Public() to exempt)
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    // Global rate limiting guard
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    // Global exception filter
    {
      provide: APP_FILTER,
      useClass: HttpExceptionFilter,
    },
    // Global logging interceptor
    {
      provide: APP_INTERCEPTOR,
      useClass: LoggingInterceptor,
    },
  ],
})
export class AppModule {}
