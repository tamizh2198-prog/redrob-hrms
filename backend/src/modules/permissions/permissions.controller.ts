import { Body, Controller, Get, Param, Patch } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../../shared/rbac/roles.decorator';
import { PermissionsService } from './permissions.service';
import { UpdateRolePermissionsDto } from './dto/update-role-permissions.dto';

// Auth Phase 5: every route here is SUPER_ADMIN-only, enforced by the
// existing global JwtAuthGuard + RolesGuard (see roles.guard.ts) — no new
// authorization mechanism is introduced.
@Controller()
@Roles(Role.SUPER_ADMIN)
export class PermissionsController {
  constructor(private readonly permissionsService: PermissionsService) {}

  @Get('roles')
  listRoles() {
    return this.permissionsService.listRoles();
  }

  @Get('permissions')
  listPermissions() {
    return this.permissionsService.listPermissions();
  }

  @Get('roles/:role/permissions')
  getRolePermissions(@Param('role') role: string) {
    return this.permissionsService.getRolePermissions(role);
  }

  @Patch('roles/:role/permissions')
  updateRolePermissions(
    @Param('role') role: string,
    @Body() dto: UpdateRolePermissionsDto,
  ) {
    return this.permissionsService.updateRolePermissions(role, dto);
  }
}
