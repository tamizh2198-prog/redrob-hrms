import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseBoolPipe,
  Patch,
  Post,
  Query,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Role } from '@prisma/client';
import { Roles } from '../../shared/rbac/roles.decorator';
import { CurrentUser } from '../../shared/auth/current-user.decorator';
import { EmployeeService } from './employee.service';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';
import { ListEmployeesQueryDto } from './dto/list-employees-query.dto';
import { InviteEmployeeDto } from './dto/invite-employee.dto';
import { UpdateMyProfileDto } from './dto/update-my-profile.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { RequesterContext } from './employee.types';
import {
  buildEmployeeImportTemplate,
  parseEmployeeImportWorkbook,
} from './bulk-import-upload.util';

// Defense-in-depth against an oversized upload, not a real-world file size —
// an employee roster sheet is at most a few thousand rows.
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

function toRequester(user?: {
  userId: string;
  role: string;
}): RequesterContext {
  return { userId: user?.userId, role: user?.role as Role | undefined };
}

@Controller('employees')
export class EmployeeController {
  constructor(private readonly employeeService: EmployeeService) {}

  @Get('reference-data')
  getReferenceData() {
    return this.employeeService.getReferenceData();
  }

  @Get('org-lookup')
  getOrgLookup() {
    return this.employeeService.getOrgLookup();
  }

  @Get('change-requests')
  @Roles(Role.HR_ADMIN, Role.SUPER_ADMIN)
  listChangeRequests(
    @Query('status') status?: 'PENDING' | 'APPROVED' | 'REJECTED',
  ) {
    return this.employeeService.listChangeRequests(status);
  }

  @Post('change-requests/:id/approve')
  @Roles(Role.HR_ADMIN, Role.SUPER_ADMIN)
  approveChangeRequest(
    @Param('id') id: string,
    @CurrentUser() user: { userId: string; role: string },
  ) {
    return this.employeeService.approveChangeRequest(id, user.userId);
  }

  @Post('change-requests/:id/reject')
  @Roles(Role.HR_ADMIN, Role.SUPER_ADMIN)
  rejectChangeRequest(
    @Param('id') id: string,
    @Body('reason') reason: string | undefined,
    @CurrentUser() user: { userId: string; role: string },
  ) {
    return this.employeeService.rejectChangeRequest(id, user.userId, reason);
  }

  @Post('bulk-import')
  @Roles(Role.HR_ADMIN, Role.SUPER_ADMIN)
  bulkImport(
    @Body('rows') rows: CreateEmployeeDto[],
    @Body('dryRun', new ParseBoolPipe({ optional: true }))
    dryRun: boolean | undefined,
    @CurrentUser() user: { userId: string; role: string },
  ) {
    return this.employeeService.bulkImport(rows, dryRun ?? true, user.userId);
  }

  // Blank starter workbook (same fields as the JSON-paste bulk-import above,
  // laid out as spreadsheet columns) so HR knows the exact format the
  // upload endpoint expects, plus a Reference sheet listing accepted enum
  // values — mirrors RosterController's hybrid-schedule template.
  @Get('bulk-import/template')
  @Roles(Role.HR_ADMIN, Role.SUPER_ADMIN)
  async getBulkImportTemplate() {
    const buffer = await buildEmployeeImportTemplate();
    return new StreamableFile(buffer, {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      disposition: 'attachment; filename="employee-bulk-import-template.xlsx"',
    });
  }

  // Excel counterpart to POST bulk-import above: same validate/dry-run/
  // commit pipeline (EmployeeService.bulkImport), just parsed from an
  // uploaded .xlsx instead of a hand-pasted JSON array.
  @Post('bulk-import/upload')
  @Roles(Role.HR_ADMIN, Role.SUPER_ADMIN)
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES } }),
  )
  async bulkImportUpload(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Query('dryRun') dryRunRaw: string | undefined,
    @CurrentUser() user: { userId: string; role: string },
  ) {
    if (!file) throw new BadRequestException('No file uploaded');
    const rows = await parseEmployeeImportWorkbook(file.buffer);
    if (rows.length === 0) {
      throw new BadRequestException(
        'No data rows found — check the sheet matches the template columns',
      );
    }
    return this.employeeService.bulkImport(
      rows as CreateEmployeeDto[],
      dryRunRaw !== 'false',
      user.userId,
    );
  }

  // Auth Phase 2: must be registered before the `:id` route below, or Nest
  // would match "invitations" as an :id param instead.
  @Get('invitations')
  @Roles(Role.HR_ADMIN, Role.SUPER_ADMIN)
  listPendingInvitations() {
    return this.employeeService.listPendingInvitations();
  }

  // This task: Super Admin-only Excel export of the active roster. Same
  // registration-order requirement as the routes above — must come before
  // the `:id` routes below.
  @Get('export/active')
  @Roles(Role.SUPER_ADMIN)
  async exportActiveEmployees() {
    const buffer = await this.employeeService.exportActiveEmployees();
    return new StreamableFile(buffer, {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      disposition: 'attachment; filename="active-employees.xlsx"',
    });
  }

  @Post('invite')
  @Roles(Role.HR_ADMIN, Role.SUPER_ADMIN)
  inviteEmployee(
    @Body() dto: InviteEmployeeDto,
    @CurrentUser() user: { userId: string; role: string },
  ) {
    return this.employeeService.inviteEmployee(
      dto,
      user.userId,
      user.role as Role,
    );
  }

  @Post(':id/resend-invitation')
  @Roles(Role.HR_ADMIN, Role.SUPER_ADMIN)
  resendInvitation(
    @Param('id') id: string,
    @CurrentUser() user: { userId: string; role: string },
  ) {
    return this.employeeService.resendInvitation(id, user.userId);
  }

  // Base @Roles gate here is deliberately broader than the actual
  // authorization — EmployeeService.assertCanResetCredentials enforces
  // that only a Super Admin can reset an HR Admin's/Super Admin's own
  // credentials, so an HR Admin reaching this route for a peer/superior
  // still gets rejected, just by the service rather than the guard.
  @Post(':id/reset-password')
  @Roles(Role.HR_ADMIN, Role.SUPER_ADMIN)
  resetPassword(
    @Param('id') id: string,
    @CurrentUser() user: { userId: string; role: string },
  ) {
    return this.employeeService.resetPassword(id, user.userId, user.role as Role);
  }

  @Post(':id/reset-mfa')
  @Roles(Role.HR_ADMIN, Role.SUPER_ADMIN)
  resetMfa(
    @Param('id') id: string,
    @CurrentUser() user: { userId: string; role: string },
  ) {
    return this.employeeService.resetMfa(id, user.role as Role);
  }

  // Auth Phase 3: employeeId always comes from the JWT via CurrentUser —
  // never from a param or body — so these two can only ever act on the
  // caller's own record. No @Roles: any authenticated employee (including
  // plain EMPLOYEE) may read/edit their own profile.
  @Get('me/profile')
  getMyProfile(@CurrentUser() user: { userId: string }) {
    return this.employeeService.getMyProfile(user.userId);
  }

  @Patch('me/profile')
  updateMyProfile(
    @Body() dto: UpdateMyProfileDto,
    @CurrentUser() user: { userId: string },
  ) {
    return this.employeeService.updateMyProfile(user.userId, dto);
  }

  @Patch('me/password')
  changeMyPassword(
    @Body() dto: ChangePasswordDto,
    @CurrentUser() user: { userId: string },
  ) {
    return this.employeeService.changeMyPassword(user.userId, dto);
  }

  @Get()
  findAll(
    @Query() query: ListEmployeesQueryDto,
    @CurrentUser() user: { userId: string; role: string },
  ) {
    return this.employeeService.findAll(query, toRequester(user));
  }

  @Post()
  @Roles(Role.HR_ADMIN, Role.SUPER_ADMIN)
  create(
    @Body() dto: CreateEmployeeDto,
    @CurrentUser() user: { userId: string; role: string },
  ) {
    return this.employeeService.create(dto, user.userId);
  }

  @Get(':id/org-chart')
  getOrgChart(
    @Param('id') id: string,
    @CurrentUser() user: { userId: string; role: string },
  ) {
    return this.employeeService.getOrgChart(id, toRequester(user));
  }

  // This task: admin employee-profile view — reuses the exact Phase 3
  // computeProfileCompletion() calculation, just scoped to an arbitrary
  // employee id instead of the caller's own (via the same read-scope rule
  // as findOne/getOrgChart above).
  @Get(':id/profile-completion')
  getProfileCompletion(
    @Param('id') id: string,
    @CurrentUser() user: { userId: string; role: string },
  ) {
    return this.employeeService.getProfileCompletionForEmployee(
      id,
      toRequester(user),
    );
  }

  // This task: controlled dismissal/deactivation. SUPER_ADMIN only, per
  // Part 12 — not extended to HR_ADMIN since no existing capability already
  // granted it. Never hard-deletes; sets the existing TERMINATED status.
  @Post(':id/dismiss')
  @Roles(Role.SUPER_ADMIN)
  dismissEmployee(
    @Param('id') id: string,
    @CurrentUser() user: { userId: string; role: string },
  ) {
    return this.employeeService.dismissEmployee(id, user.userId);
  }

  // This task: permanent removal, for test/development cleanup only —
  // SUPER_ADMIN-gated, separate from and does not alter the dismiss (soft
  // terminate) endpoint above.
  @Delete(':id')
  @Roles(Role.SUPER_ADMIN)
  deleteEmployee(@Param('id') id: string) {
    return this.employeeService.deleteEmployee(id);
  }

  @Post(':id/reveal')
  reveal(
    @Param('id') id: string,
    @CurrentUser() user: { userId: string; role: string },
  ) {
    return this.employeeService.revealSensitiveFields(id, toRequester(user));
  }

  @Get(':id')
  findOne(
    @Param('id') id: string,
    @CurrentUser() user: { userId: string; role: string },
  ) {
    return this.employeeService.findOne(id, toRequester(user));
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateEmployeeDto,
    @CurrentUser() user: { userId: string; role: string },
  ) {
    return this.employeeService.update(id, dto, toRequester(user));
  }
}
