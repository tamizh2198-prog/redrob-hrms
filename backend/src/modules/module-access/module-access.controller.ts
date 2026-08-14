import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../../shared/rbac/roles.decorator';
import { CurrentUser } from '../../shared/auth/current-user.decorator';
import { ModuleAccessService } from './module-access.service';
import { GrantModuleAccessDto } from './dto/grant-module-access.dto';

// Section 6 Access Control: granting one employee an exception to their own
// role's access is itself an administrative act — Super Admin only, same
// as assigning HR_ADMIN/SUPER_ADMIN in the invite flow.
@Controller('module-access')
@Roles(Role.SUPER_ADMIN)
export class ModuleAccessController {
  constructor(private readonly moduleAccessService: ModuleAccessService) {}

  @Get('modules')
  listModules() {
    return this.moduleAccessService.listModules();
  }

  @Post()
  grant(
    @Body() dto: GrantModuleAccessDto,
    @CurrentUser() user: { userId: string },
  ) {
    return this.moduleAccessService.grant(dto.employeeId, dto.module, user.userId);
  }

  @Delete(':employeeId/:module')
  revoke(
    @Param('employeeId') employeeId: string,
    @Param('module') module: string,
  ) {
    return this.moduleAccessService.revoke(employeeId, module);
  }

  @Get(':employeeId')
  listForEmployee(@Param('employeeId') employeeId: string) {
    return this.moduleAccessService.listForEmployee(employeeId);
  }
}
