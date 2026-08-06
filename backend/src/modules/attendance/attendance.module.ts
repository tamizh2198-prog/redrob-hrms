import { Module } from '@nestjs/common';
import { AttendanceController } from './attendance.controller';
import { AttendanceService } from './attendance.service';
import { AttendanceRemindersService } from './attendance-reminders.service';

@Module({
  controllers: [AttendanceController],
  providers: [AttendanceService, AttendanceRemindersService],
  exports: [AttendanceService],
})
export class AttendanceModule {}
