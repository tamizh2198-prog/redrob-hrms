import { Module } from '@nestjs/common';
import { HolidayController } from './holiday.controller';
import { HolidayService } from './holiday.service';
import { OptionalHolidayReminderService } from './optional-holiday-reminder.service';

@Module({
  controllers: [HolidayController],
  providers: [HolidayService, OptionalHolidayReminderService],
  exports: [HolidayService],
})
export class HolidayModule {}
