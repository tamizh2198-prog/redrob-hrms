import { Module } from '@nestjs/common';
import { LeaveModule } from '../leave/leave.module';
import { HolidayModule } from '../holiday/holiday.module';
import { HelpdeskModule } from '../helpdesk/helpdesk.module';
import { AssistantController } from './assistant.controller';
import { AssistantService } from './assistant.service';
import { AssistantLlmGateway } from './assistant-llm.gateway';
import { AssistantAnomalyDigestService } from './assistant-anomaly-digest.service';

@Module({
  imports: [LeaveModule, HolidayModule, HelpdeskModule],
  controllers: [AssistantController],
  providers: [
    AssistantService,
    AssistantLlmGateway,
    AssistantAnomalyDigestService,
  ],
})
export class AssistantModule {}
