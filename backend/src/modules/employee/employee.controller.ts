import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseBoolPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../../shared/rbac/roles.decorator';
import { CurrentUser } from '../../shared/auth/current-user.decorator';
import { EmployeeService } from './employee.service';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';
import { ListEmployeesQueryDto } from './dto/list-employees-query.dto';
import { InviteEmployeeDto } from './dto/invite-employee.dto';
import { UpdateMyProfileDto } from './dto/update-my-profile.dto';
import { RequesterContext } from './employee.types';

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

  // Auth Phase 2: must be registered before the `:id` route below, or Nest
  // would match "invitations" as an :id param instead.
  @Get('invitations')
  @Roles(Role.HR_ADMIN, Role.SUPER_ADMIN)
  listPendingInvitations() {
    return this.employeeService.listPendingInvitations();
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
