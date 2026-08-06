import { Controller, Get, Post, Body } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../../shared/rbac/roles.decorator';
import { ShiftService } from './shift.service';
import { CreateShiftDto } from './dto/create-shift.dto';
import { UpdateHybridPolicyDto } from './dto/update-hybrid-policy.dto';

@Controller('shifts')
export class ShiftController {
  constructor(private readonly shiftService: ShiftService) {}

  @Post()
  @Roles(Role.HR_ADMIN, Role.SUPER_ADMIN)
  create(@Body() dto: CreateShiftDto) {
    return this.shiftService.createShift(dto);
  }

  @Get()
  list() {
    return this.shiftService.listShifts();
  }

  @Get('hybrid-policy')
  getHybridPolicy() {
    return this.shiftService.getHybridPolicy();
  }

  @Post('hybrid-policy')
  @Roles(Role.HR_ADMIN, Role.SUPER_ADMIN)
  updateHybridPolicy(@Body() dto: UpdateHybridPolicyDto) {
    return this.shiftService.updateHybridPolicy(dto);
  }
}
