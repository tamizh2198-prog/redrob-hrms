import { Controller, Get, Post, Body } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../../shared/rbac/roles.decorator';
import { ShiftService } from './shift.service';
import { CreateShiftDto } from './dto/create-shift.dto';

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
}
