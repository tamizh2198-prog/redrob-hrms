import {
  Body,
  Controller,
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
