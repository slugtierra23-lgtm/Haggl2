import { Module } from '@nestjs/common';

import { PrismaModule } from '../../common/prisma/prisma.module';
import { RedisModule } from '../../common/redis/redis.module';

import { BoltyGuardController } from './boltyguard.controller';
import { BoltyGuardService } from './boltyguard.service';
import { BundleScanner } from './bundle-scanner';
import { GithubFetcher } from './github-fetcher';
import { HolderGateService } from './holder-gate.service';
import { SemgrepRunner } from './semgrep-runner';

@Module({
  imports: [PrismaModule, RedisModule],
  controllers: [BoltyGuardController],
  providers: [BoltyGuardService, SemgrepRunner, HolderGateService, BundleScanner, GithubFetcher],
  exports: [BoltyGuardService],
})
export class BoltyGuardModule {}
