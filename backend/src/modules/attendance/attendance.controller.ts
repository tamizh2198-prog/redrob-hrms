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
import { AttendanceService } from './attendance.service';
import { PunchDto } from './dto/punch.dto';
import { RegularizeDto } from './dto/regularize.dto';
import { RegularizationDecisionDto } from './dto/regularization-decision.dto';
import { ImportBiometricDto } from './dto/import-biometric.dto';
import { LockMonthDto } from './dto/lock-month.dto';
import { CreateOvertimeClaimDto } from './dto/create-overtime-claim.dto';
import { AddCommentDto } from '../../shared/request-comments/add-comment.dto';
import {
  buildBiometricImportTemplate,
  parseBiometricWorkbook,
} from './biometric-import-upload.util';

// Defense-in-depth against an oversized upload, not a real-world file size —
// a biometric attendance sheet is a handful of columns/rows (same rationale
// as roster.controller.ts's hybrid-schedule bulk-upload).
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

@Controller('attendance')
@RequiresModule('ATTENDANCE')
export class AttendanceController {
  constructor(private readonly attendanceService: AttendanceService) {}

  @Post('punch')
  punch(@Body() dto: PunchDto, @CurrentUser() user: { userId: string }) {
    return this.attendanceService.punch(user.userId, dto.type);
  }

  @Get(':employeeId/calendar')
  getCalendar(
    @Param('employeeId') employeeId: string,
    @Query('year') year: string,
    @Query('month') month: string,
    @CurrentUser() user: { userId: string; role: string },
  ) {
    return this.attendanceService.getCalendar(
      employeeId,
      parseInt(year, 10),
      parseInt(month, 10),
      { userId: user.userId, role: user.role as Role },
    );
  }

  @Post('regularize')
  regularize(
    @Body() dto: RegularizeDto,
    @CurrentUser() user: { userId: string },
  ) {
    return this.attendanceService.regularize(user.userId, dto);
  }

  @Get('regularize')
  listRegularizations(
    @Query('employeeId') employeeId?: string,
    @Query('approverId') approverId?: string,
    @Query('status') status?: 'PENDING' | 'APPROVED' | 'REJECTED',
  ) {
    return this.attendanceService.listRegularizations({
      employeeId,
      approverId,
      status,
    });
  }

  @Post('regularize/:id/decision')
  decideRegularization(
    @Param('id') id: string,
    @Body() dto: RegularizationDecisionDto,
    @CurrentUser() user: { userId: string; role: string },
  ) {
    return this.attendanceService.decideRegularization(
      id,
      user.userId,
      dto,
      user.role as Role,
    );
  }

  @Post('overtime')
  submitOvertimeClaim(
    @Body() dto: CreateOvertimeClaimDto,
    @CurrentUser() user: { userId: string },
  ) {
    return this.attendanceService.submitOvertimeClaim(user.userId, dto);
  }

  @Get('overtime')
  listOvertimeClaims(
    @Query('employeeId') employeeId?: string,
    @Query('approverId') approverId?: string,
    @Query('status')
    status?: 'PENDING_MANAGER' | 'PENDING_SUPER_ADMIN' | 'APPROVED' | 'REJECTED',
  ) {
    return this.attendanceService.listOvertimeClaims({
      employeeId,
      approverId,
      status,
    });
  }

  @Get('overtime/all')
  @Roles(Role.SUPER_ADMIN)
  listAllOvertimeClaims(
    @Query('status')
    status?: 'PENDING_MANAGER' | 'PENDING_SUPER_ADMIN' | 'APPROVED' | 'REJECTED',
  ) {
    return this.attendanceService.listOvertimeClaims({ status });
  }

  // Claims a manager already approved, awaiting the final Super Admin
  // sign-off — any Super Admin can act on these, not just one assigned
  // approver, so this is company-wide rather than approverId-scoped.
  @Get('overtime/pending-super-admin')
  @Roles(Role.SUPER_ADMIN)
  listPendingSuperAdminOvertime() {
    return this.attendanceService.listPendingSuperAdminOvertime();
  }

  @Post('overtime/:id/decision')
  decideOvertimeClaim(
    @Param('id') id: string,
    @Body() dto: RegularizationDecisionDto,
    @CurrentUser() user: { userId: string; role: string },
  ) {
    return this.attendanceService.decideOvertimeClaim(
      id,
      user.userId,
      dto,
      user.role as Role,
    );
  }

  @Post('overtime/:id/comments')
  @Roles(Role.SUPER_ADMIN)
  addOvertimeComment(
    @Param('id') id: string,
    @Body() dto: AddCommentDto,
    @CurrentUser() user: { userId: string },
  ) {
    return this.attendanceService.addOvertimeComment(
      id,
      user.userId,
      dto.body,
    );
  }

  @Get('overtime/:id/comments')
  listOvertimeComments(
    @Param('id') id: string,
    @CurrentUser() user: { userId: string; role: string },
  ) {
    return this.attendanceService.listOvertimeComments(
      id,
      user.userId,
      user.role as Role,
    );
  }

  @Post('import')
  @Roles(Role.HR_ADMIN, Role.SUPER_ADMIN)
  importBiometric(@Body() dto: ImportBiometricDto) {
    return this.attendanceService.importBiometric(dto);
  }

  // Bulk-upload counterpart to POST import above: same employeeCode/date/
  // check-in/check-out row shape, sourced from an .xlsx workbook instead of
  // a hand-pasted JSON array. Registered as literal path segments under
  // 'import', so route order relative to the ':employeeId/calendar' route
  // above doesn't matter (no ':param' segment to be shadowed here).
  @Get('import/template')
  @Roles(Role.HR_ADMIN, Role.SUPER_ADMIN)
  async getBiometricImportTemplate() {
    const buffer = await buildBiometricImportTemplate();
    return new StreamableFile(buffer, {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      disposition: 'attachment; filename="biometric-attendance-template.xlsx"',
    });
  }

  @Post('import/upload')
  @Roles(Role.HR_ADMIN, Role.SUPER_ADMIN)
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES } }),
  )
  async bulkUploadBiometric(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Query('dryRun') dryRunRaw?: string,
  ) {
    if (!file) throw new BadRequestException('No file uploaded');
    let rows;
    try {
      rows = await parseBiometricWorkbook(file.buffer);
    } catch {
      throw new BadRequestException(
        "Could not read the uploaded file — make sure it's a valid .xlsx workbook",
      );
    }
    if (rows.length === 0) {
      throw new BadRequestException(
        'No data rows found — check the sheet matches the template columns (Employee Code, Date, Check-In Time, Check-Out Time)',
      );
    }
    return this.attendanceService.bulkImportBiometric(
      rows,
      dryRunRaw === 'true',
    );
  }

  @Post('lock')
  @Roles(Role.HR_ADMIN, Role.SUPER_ADMIN)
  lockMonth(@Body() dto: LockMonthDto) {
    return this.attendanceService.lockMonth(dto.year, dto.month);
  }
}
