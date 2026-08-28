import { Module } from '@nestjs/common';
import { HolidayModule } from '../holiday/holiday.module';
import { HelpdeskModule } from '../helpdesk/helpdesk.module';
import { AssistantController } from './assistant.controller';
import { AssistantService } from './assistant.service';
import { AssistantLlmGateway } from './assistant-llm.gateway';
import { AssistantAnomalyDigestService } from './assistant-anomaly-digest.service';

@Module({
  imports: [HolidayModule, HelpdeskModule],
  controllers: [AssistantController],
  providers: [
    AssistantService,
    AssistantLlmGateway,
    AssistantAnomalyDigestService,
  ],
})
export class AssistantModule {}
