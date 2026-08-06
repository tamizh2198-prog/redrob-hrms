import { Global, Module } from '@nestjs/common';
import { CalendarService } from './calendar.service';

@Global()
@Module({
  providers: [CalendarService],
  exports: [CalendarService],
})
export class CalendarModule {}
