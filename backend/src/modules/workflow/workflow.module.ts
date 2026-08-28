import { Module } from '@nestjs/common';
import { AssetsModule } from '../assets/assets.module';
import { WorkflowController } from './workflow.controller';
import { WorkflowService } from './workflow.service';
import { WorkflowEscalationService } from './workflow-escalation.service';

@Module({
  imports: [AssetsModule],
  controllers: [WorkflowController],
  providers: [WorkflowService, WorkflowEscalationService],
})
export class WorkflowModule {}
