import { Controller } from '@nestjs/common';
import { HolidayService } from './holiday.service';

@Controller('holiday')
export class HolidayController {
  constructor(private readonly holidayService: HolidayService) {}
}
