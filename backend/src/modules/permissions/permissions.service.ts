import { BadRequestException, Injectable } from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../../shared/database/prisma.service';
import { UpdateRolePermissionsDto } from './dto/update-role-permissions.dto';
import { ROLE_DEFAULT_MODULES } from '../../shared/rbac/roles.guard';

const ALL_ROLES = Object.values(Role);

function assertValidRole(role: string): Role {
  if (!ALL_ROLES.includes(role as Role)) {
    throw new BadRequestException(`Unknown role: ${role}`);
  }
  return role as Role;
}

// HR Associate (Roles & Permissions UI): its real access — Onboarding,
// Offboarding, Assets — is enforced entirely by RolesGuard's
// ROLE_DEFAULT_MODULES map, not by the Permission/RolePermission catalog
// below (which has no "Onboarding" category and isn't shaped for
// whole-module operational access anyway). getRolePermissions() renders
// that real, authoritative access directly instead of the catalog's
// permanently-empty (exhaustiveness-only) entry for this role — this is
// purely representational and introduces no second authorization mechanism.
// Labels mirror the app's own existing nav/page terminology exactly.
const HR_ASSOCIATE_RESTRICTED_LABELS = [
  'Employee Directory',
  'CTC / Salary',
  'Create Leave Type',
  'Roles & Permissions',
  'Audit Logs',
  'Recruitment (ATS)',
];

function titleCaseModule(moduleName: string) {
  return moduleName.charAt(0) + moduleName.slice(1).toLowerCase();
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

    if (role === Role.HR_ASSOCIATE) {
      const modules = ROLE_DEFAULT_MODULES[Role.HR_ASSOCIATE] ?? [];
      return {
        role,
        editable: false,
        permissions: [
          ...modules.map((module) => ({
            id: `module-${module}`,
            key: `module.${module.toLowerCase()}`,
            name: titleCaseModule(module),
            description:
              'Operational access granted directly by role (RolesGuard) — not controlled by this catalog.',
            category: 'Operational Modules',
            enabled: true,
          })),
          ...HR_ASSOCIATE_RESTRICTED_LABELS.map((label) => ({
            id: `restricted-${label}`,
            key: `restricted.${label.toLowerCase().replace(/[^a-z]+/g, '-')}`,
            name: label,
            description: 'HR Admin / Super Admin only.',
            category: 'Not Available to HR Associate',
            enabled: false,
          })),
        ],
      };
    }

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
    if (role === Role.HR_ASSOCIATE) {
      throw new BadRequestException(
        'HR_ASSOCIATE access is granted by role via RolesGuard, not through this catalog, and cannot be modified here',
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
