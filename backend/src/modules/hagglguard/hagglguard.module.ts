import { Module } from '@nestjs/common';

import { PrismaModule } from '../../common/prisma/prisma.module';
import { RedisModule } from '../../common/redis/redis.module';

import { HagglGuardController } from './hagglguard.controller';
import { HagglGuardService } from './hagglguard.service';
import { BundleScanner } from './bundle-scanner';
import { GithubFetcher } from './github-fetcher';
import { HolderGateService } from './holder-gate.service';
import { SemgrepRunner } from './semgrep-runner';

@Module({
  imports: [PrismaModule, RedisModule],
  controllers: [HagglGuardController],
  providers: [HagglGuardService, SemgrepRunner, HolderGateService, BundleScanner, GithubFetcher],
  exports: [HagglGuardService],
})
export class HagglGuardModule {}
