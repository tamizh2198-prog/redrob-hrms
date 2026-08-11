import { Module } from '@nestjs/common';
import { HelpdeskController } from './helpdesk.controller';
import { HelpdeskService } from './helpdesk.service';
import { HelpdeskEscalationService } from './helpdesk-escalation.service';

@Module({
  controllers: [HelpdeskController],
  providers: [HelpdeskService, HelpdeskEscalationService],
  exports: [HelpdeskService],
})
export class HelpdeskModule {}
