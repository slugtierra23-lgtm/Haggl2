import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';

import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

import { AgentsTestService } from './agents-test.service';
import { ProtocolKind } from './protocols/protocol-adapter.interface';

interface TestDeployBody {
  protocol?: ProtocolKind;
  endpoint?: string;
  model?: string;
  apiKey?: string;
  samplePrompt?: string;
}

/**
 * `/api/v1/agents/test-deploy` — runs end-to-end probe of a candidate
 * agent endpoint and returns a structured diagnostic. Authenticated +
 * heavily throttled (sellers should not be able to use the platform as
 * a free port-scanner against the internet).
 */
@Controller('agents')
export class AgentsTestController {
  constructor(private readonly agents: AgentsTestService) {}

  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('test-deploy')
  async testDeploy(@Body() body: TestDeployBody) {
    const protocol = (body?.protocol ?? 'webhook') as ProtocolKind;
    const endpoint = (body?.endpoint ?? '').trim();
    const model = body?.model?.trim();
    const apiKey = body?.apiKey?.trim();
    const samplePrompt = (body?.samplePrompt ?? '').trim() || undefined;

    return this.agents.test(protocol, { endpoint, model, apiKey }, samplePrompt);
  }
}
