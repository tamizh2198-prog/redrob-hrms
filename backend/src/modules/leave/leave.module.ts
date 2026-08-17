import { Module } from '@nestjs/common';
import { LeaveController } from './leave.controller';
import { CompOffController } from './comp-off.controller';
import { LeaveService } from './leave.service';
import { CompOffService } from './comp-off.service';
import { LeaveScheduleService } from './leave-schedule.service';
import { AttendanceModule } from '../attendance/attendance.module';

@Module({
  imports: [AttendanceModule],
  controllers: [LeaveController, CompOffController],
  providers: [LeaveService, CompOffService, LeaveScheduleService],
  exports: [LeaveService],
})
export class LeaveModule {}
