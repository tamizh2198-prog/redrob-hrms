import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../../shared/rbac/roles.decorator';
import { CurrentUser } from '../../shared/auth/current-user.decorator';
import { ShiftService } from './shift.service';
import { AssignRosterDto } from './dto/assign-roster.dto';
import { RequestShiftSwapDto } from './dto/request-shift-swap.dto';

@Controller('roster')
export class RosterController {
  constructor(private readonly shiftService: ShiftService) {}

  @Post('assign')
  @Roles(Role.HR_ADMIN, Role.SUPER_ADMIN)
  assign(@Body() dto: AssignRosterDto, @CurrentUser() user: { role: string }) {
    return this.shiftService.assignRoster(dto, user.role as Role);
  }

  @Get('swap')
  listSwaps(
    @Query('employeeId') employeeId?: string,
    @Query('approverId') approverId?: string,
  ) {
    return this.shiftService.listSwaps({ employeeId, approverId });
  }

  @Get(':employeeId')
  getRoster(
    @Param('employeeId') employeeId: string,
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    return this.shiftService.getRoster(
      employeeId,
      new Date(from),
      new Date(to),
    );
  }

  @Post('swap')
  requestSwap(
    @Body() dto: RequestShiftSwapDto,
    @CurrentUser() user: { userId: string; role: string },
  ) {
    return this.shiftService.requestSwap(user.userId, dto, user.role as Role);
  }

  @Post('swap/:id/decision')
  decideSwap(
    @Param('id') id: string,
    @Body('approve') approve: boolean,
    @CurrentUser() user: { userId: string; role: string },
  ) {
    return this.shiftService.decideSwap(
      id,
      user.userId,
      approve,
      user.role as Role,
    );
  }
}
