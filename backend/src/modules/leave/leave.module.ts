import { Module } from '@nestjs/common';
import { LeaveController } from './leave.controller';
import { LeaveService } from './leave.service';
import { LeaveScheduleService } from './leave-schedule.service';
import { AttendanceModule } from '../attendance/attendance.module';

@Module({
  imports: [AttendanceModule],
  controllers: [LeaveController],
  providers: [LeaveService, LeaveScheduleService],
  exports: [LeaveService],
})
export class LeaveModule {}
