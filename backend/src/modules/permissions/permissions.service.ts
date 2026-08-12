import { BadRequestException, Injectable } from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../../shared/database/prisma.service';
import { UpdateRolePermissionsDto } from './dto/update-role-permissions.dto';

const ALL_ROLES = Object.values(Role);

function assertValidRole(role: string): Role {
  if (!ALL_ROLES.includes(role as Role)) {
    throw new BadRequestException(`Unknown role: ${role}`);
  }
  return role as Role;
}

@Injectable()
export class PermissionsService {
  constructor(private readonly prisma: PrismaService) {}

  listRoles() {
    return ALL_ROLES.map((role) => ({ role }));
  }

  listPermissions() {
    return this.prisma.permission.findMany({
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
    });
  }

  async getRolePermissions(roleParam: string) {
    const role = assertValidRole(roleParam);
    const [permissions, rolePermissions] = await Promise.all([
      this.listPermissions(),
      this.prisma.rolePermission.findMany({ where: { role } }),
    ]);
    const enabledIds = new Set(rolePermissions.map((rp) => rp.permissionId));
    return {
      role,
      editable: role !== Role.SUPER_ADMIN,
      permissions: permissions.map((p) => ({
        ...p,
        enabled: enabledIds.has(p.id),
      })),
    };
  }

  // Auth Phase 5 security: SUPER_ADMIN's permission set is not editable
  // through this API. Every existing module's authorization still runs
  // through @Roles(Role.SUPER_ADMIN)/RolesGuard, not this catalog, so
  // unchecking a box here would not actually restrict Super Admin access —
  // it would only mislead whoever is looking at the UI. Blocking the write
  // outright keeps the catalog honest about what it currently controls.
  async updateRolePermissions(
    roleParam: string,
    dto: UpdateRolePermissionsDto,
  ) {
    const role = assertValidRole(roleParam);
    if (role === Role.SUPER_ADMIN) {
      throw new BadRequestException(
        'SUPER_ADMIN permissions cannot be modified',
      );
    }

    const uniqueIds = Array.from(new Set(dto.permissionIds));
    if (uniqueIds.length > 0) {
      const found = await this.prisma.permission.findMany({
        where: { id: { in: uniqueIds } },
        select: { id: true },
      });
      if (found.length !== uniqueIds.length) {
        throw new BadRequestException(
          'One or more permission ids do not exist',
        );
      }
    }

    await this.prisma.$transaction([
      this.prisma.rolePermission.deleteMany({ where: { role } }),
      this.prisma.rolePermission.createMany({
        data: uniqueIds.map((permissionId) => ({ role, permissionId })),
      }),
    ]);

    return this.getRolePermissions(role);
  }
}
