import { Module } from '@nestjs/common';
import { LeaveModule } from '../leave/leave.module';
import { AttendanceModule } from '../attendance/attendance.module';
import { AssetsModule } from '../assets/assets.module';
import { WorkflowController } from './workflow.controller';
import { WorkflowService } from './workflow.service';
import { WorkflowEscalationService } from './workflow-escalation.service';

@Module({
  imports: [LeaveModule, AttendanceModule, AssetsModule],
  controllers: [WorkflowController],
  providers: [WorkflowService, WorkflowEscalationService],
})
export class WorkflowModule {}
