import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../../shared/rbac/roles.decorator';
import { CurrentUser } from '../../shared/auth/current-user.decorator';
import { LeaveService } from './leave.service';
import { CreateLeaveTypeDto } from './dto/create-leave-type.dto';
import { ApplyLeaveDto } from './dto/apply-leave.dto';
import { LeaveDecisionDto } from './dto/leave-decision.dto';

@Controller('leave')
export class LeaveController {
  constructor(private readonly leaveService: LeaveService) {}

  @Get('types')
  listTypes() {
    return this.leaveService.listLeaveTypes();
  }

  @Post('policy')
  @Roles(Role.HR_ADMIN, Role.SUPER_ADMIN)
  createPolicy(@Body() dto: CreateLeaveTypeDto) {
    return this.leaveService.createLeaveType(dto);
  }

  @Get('balance/:employeeId')
  getBalance(
    @Param('employeeId') employeeId: string,
    @Query('year') year: string | undefined,
    @CurrentUser() user: { userId: string; role: string },
  ) {
    return this.leaveService.getBalances(
      employeeId,
      year ? parseInt(year, 10) : new Date().getFullYear(),
      { userId: user.userId, role: user.role as Role },
    );
  }

  @Post('apply')
  apply(@Body() dto: ApplyLeaveDto, @CurrentUser() user: { userId: string }) {
    return this.leaveService.applyLeave(user.userId, dto);
  }

  @Post(':id/decision')
  decide(
    @Param('id') id: string,
    @Body() dto: LeaveDecisionDto,
    @CurrentUser() user: { userId: string; role: string },
  ) {
    return this.leaveService.decideLeave(
      id,
      user.userId,
      dto,
      user.role as Role,
    );
  }

  @Post(':id/cancel')
  cancel(
    @Param('id') id: string,
    @CurrentUser() user: { userId: string; role: string },
  ) {
    return this.leaveService.cancelLeave(id, user.userId, user.role as Role);
  }

  @Get('my-applications')
  myApplications(@CurrentUser() user: { userId: string }) {
    return this.leaveService.listMyApplications(user.userId);
  }

  @Get('pending-approvals')
  pendingApprovals(@CurrentUser() user: { userId: string }) {
    return this.leaveService.listPendingApprovals(user.userId);
  }

  @Get('team-calendar')
  teamCalendar(
    @Query('from') from: string,
    @Query('to') to: string,
    @CurrentUser() user: { userId: string },
  ) {
    return this.leaveService.getTeamCalendar(
      user.userId,
      new Date(from),
      new Date(to),
    );
  }

  @Post('accrual/run')
  @Roles(Role.HR_ADMIN, Role.SUPER_ADMIN)
  runAccrual(@Body('year') year: number, @Body('month') month: number) {
    return this.leaveService.runMonthlyAccrual(year, month);
  }

  @Post('year-end-close')
  @Roles(Role.HR_ADMIN, Role.SUPER_ADMIN)
  runYearEndClose(@Body('year') year: number) {
    return this.leaveService.runYearEndClose(year);
  }
}
