import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../../shared/rbac/roles.decorator';
import { RequiresModule } from '../../shared/rbac/requires-module.decorator';
import { CurrentUser } from '../../shared/auth/current-user.decorator';
import { HolidayService } from './holiday.service';
import { CreateHolidayCalendarDto } from './dto/create-holiday-calendar.dto';
import { SelectOptionalHolidayDto } from './dto/select-optional-holiday.dto';

@Controller('holidays')
@RequiresModule('HOLIDAY')
export class HolidayController {
  constructor(private readonly holidayService: HolidayService) {}

  @Post('calendar')
  @Roles(Role.HR_ADMIN, Role.HR_ASSOCIATE, Role.SUPER_ADMIN)
  createCalendar(@Body() dto: CreateHolidayCalendarDto) {
    return this.holidayService.createCalendar(dto);
  }

  @Get('calendar')
  listCalendar(
    @Query('locationId') locationId: string,
    @Query('year') year: string,
  ) {
    return this.holidayService.listCalendar(locationId, parseInt(year, 10));
  }

  @Post('optional/select')
  selectOptionalHoliday(
    @Body() dto: SelectOptionalHolidayDto,
    @CurrentUser() user: { userId: string },
  ) {
    return this.holidayService.selectOptionalHoliday(
      user.userId,
      dto.holidayId,
    );
  }

  @Get('optional/selections')
  listSelections(@CurrentUser() user: { userId: string }) {
    return this.holidayService.listSelections(user.userId);
  }
}
