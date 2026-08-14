import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Role } from '@prisma/client';
import { Roles } from '../../shared/rbac/roles.decorator';
import { RequiresModule } from '../../shared/rbac/requires-module.decorator';
import { CurrentUser } from '../../shared/auth/current-user.decorator';
import { ShiftService } from './shift.service';
import { AssignRosterDto } from './dto/assign-roster.dto';
import { SetHybridScheduleDto } from './dto/set-hybrid-schedule.dto';
import {
  buildHybridScheduleTemplate,
  parseHybridScheduleWorkbook,
} from './hybrid-schedule-upload.util';

// Defense-in-depth against an oversized upload, not a real-world file size —
// a schedule sheet is a handful of columns/rows.
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

@Controller('roster')
@RequiresModule('SHIFT')
export class RosterController {
  constructor(private readonly shiftService: ShiftService) {}

  @Post('assign')
  @Roles(Role.HR_ADMIN, Role.SUPER_ADMIN)
  assign(@Body() dto: AssignRosterDto, @CurrentUser() user: { role: string }) {
    return this.shiftService.assignRoster(dto, user.role as Role);
  }

  // Registered before the ':employeeId' route below so the literal path
  // segment isn't swallowed as an employee id.
  @Get('hybrid-schedule')
  getHybridSchedule(
    @Query('employeeId') employeeId: string,
    @Query('year') year: string,
    @Query('month') month: string,
    @CurrentUser() user: { userId: string; role: string },
  ) {
    return this.shiftService.getEmployeeHybridSchedule(
      employeeId,
      Number(year),
      Number(month),
      { userId: user.userId, role: user.role as Role },
    );
  }

  @Post('hybrid-schedule')
  @Roles(Role.HR_ADMIN, Role.SUPER_ADMIN)
  setHybridSchedule(@Body() dto: SetHybridScheduleDto) {
    return this.shiftService.setEmployeeHybridSchedule(dto);
  }

  // Blank starter workbook (Employee Code / Year / Month / one column per
  // weekday) so HR knows the exact format the bulk-upload endpoint expects.
  @Get('hybrid-schedule/template')
  @Roles(Role.HR_ADMIN, Role.SUPER_ADMIN)
  async getHybridScheduleTemplate() {
    const buffer = await buildHybridScheduleTemplate();
    return new StreamableFile(buffer, {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      disposition: 'attachment; filename="wfo-days-template.xlsx"',
    });
  }

  // Bulk counterpart to POST hybrid-schedule above: one row per employee,
  // each with its own office-weekday pattern, instead of repeating the
  // single-employee form one person at a time.
  @Post('hybrid-schedule/bulk-upload')
  @Roles(Role.HR_ADMIN, Role.SUPER_ADMIN)
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES } }),
  )
  async bulkUploadHybridSchedule(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Query('dryRun') dryRunRaw?: string,
  ) {
    if (!file) throw new BadRequestException('No file uploaded');
    const rows = await parseHybridScheduleWorkbook(file.buffer);
    if (rows.length === 0) {
      throw new BadRequestException(
        'No data rows found — check the sheet matches the template columns (Employee Code, Year, Month, Sun..Sat)',
      );
    }
    return this.shiftService.bulkSetHybridSchedule(rows, dryRunRaw === 'true');
  }

  @Get(':employeeId')
  getRoster(
    @Param('employeeId') employeeId: string,
    @Query('from') from: string,
    @Query('to') to: string,
    @CurrentUser() user: { userId: string; role: string },
  ) {
    return this.shiftService.getRoster(
      employeeId,
      new Date(from),
      new Date(to),
      { userId: user.userId, role: user.role as Role },
    );
  }
}
