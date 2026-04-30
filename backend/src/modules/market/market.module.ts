import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';

import { AuthModule } from '../auth/auth.module';
import { HagglGuardModule } from '../hagglguard/hagglguard.module';
import { DmModule } from '../dm/dm.module';
import { EmailModule } from '../email/email.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ReputationModule } from '../reputation/reputation.module';

import { AgentHealthService } from './agent-health.service';
import { AgentPostsController } from './agent-posts.controller';
import { AgentPostsService } from './agent-posts.service';
import { AgentSandboxService } from './agent-sandbox.service';
import { AgentScanService } from './agent-scan.service';
import { ApiKeysService } from './api-keys.service';
import { MarketController } from './market.controller';
import { MarketGateway } from './market.gateway';
import { MarketService } from './market.service';
import { NegotiationService } from './negotiation.service';
import { NegotiationsGateway } from './negotiations.gateway';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    AuthModule,
    EmailModule,
    DmModule,
    NotificationsModule,
    ReputationModule,
    HagglGuardModule,
  ],
  controllers: [AgentPostsController, MarketController],
  providers: [
    MarketService,
    MarketGateway,
    NegotiationService,
    NegotiationsGateway,
    AgentPostsService,
    AgentSandboxService,
    AgentScanService,
    ApiKeysService,
    AgentHealthService,
  ],
  exports: [MarketGateway, MarketService],
})
export class MarketModule {}
