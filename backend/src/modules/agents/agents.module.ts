import { Module } from '@nestjs/common';

import { AgentsTestController } from './agents-test.controller';
import { AgentsTestService } from './agents-test.service';
import { AgentsController } from './agents.controller';
import { AgentsService } from './agents.service';
import { McpAdapter } from './protocols/mcp.adapter';
import { OpenAiAdapter } from './protocols/openai.adapter';
import { WebhookAdapter } from './protocols/webhook.adapter';

@Module({
  controllers: [AgentsController, AgentsTestController],
  providers: [AgentsService, AgentsTestService, WebhookAdapter, McpAdapter, OpenAiAdapter],
  exports: [AgentsService, AgentsTestService, WebhookAdapter, McpAdapter, OpenAiAdapter],
})
export class AgentsModule {}
