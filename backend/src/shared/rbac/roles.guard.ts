import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from './role.enum';
import { ROLES_KEY } from './roles.decorator';
import { MODULE_KEY } from './requires-module.decorator';
import { AuthenticatedRequest } from '../auth/authenticated-request.interface';
import { PrismaService } from '../database/prisma.service';

// HR Associate (Phase 2): a fixed, role-based default — unlike the
// per-employee ModuleAccessGrant below (a Super Admin-managed exception on
// one employee), every HR_ASSOCIATE automatically gets these 3 modules'
// operational access and nothing else. Deliberately not a general HR_ADMIN
// alias: HR_ASSOCIATE still fails @Roles(HR_ADMIN, SUPER_ADMIN) on every
// module outside this list (Employee, Leave Type management, Settings,
// Roles & Permissions, Audit, ...) exactly as before, since those
// controllers carry no @RequiresModule() for this fallback to ever reach.
// Exported so the Roles & Permissions UI (permissions.service.ts) can
// display HR_ASSOCIATE's real, enforced access instead of maintaining a
// second, independent list that could drift out of sync with this one.
export const ROLE_DEFAULT_MODULES: Partial<Record<Role, readonly string[]>> = {
  [Role.HR_ASSOCIATE]: ['ONBOARDING', 'OFFBOARDING', 'ASSETS'],
};

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredRoles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }
    const { user } = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!user) return false;
    if (requiredRoles.includes(user.role as Role)) return true;

    // This task (Super Admin per-employee module access): a route tagged
    // with @RequiresModule() alongside @Roles() also admits a caller who
    // doesn't hold one of those roles but has an explicit grant for this
    // specific module — an exception scoped to one module, not a general
    // role upgrade.
    const requiredModule = this.reflector.getAllAndOverride<string>(
      MODULE_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (requiredModule) {
      // Role-based default (HR Associate) — checked first since it's a
      // synchronous, no-DB-lookup case; falls through to the per-employee
      // grant lookup unchanged for every other role.
      if (ROLE_DEFAULT_MODULES[user.role as Role]?.includes(requiredModule)) {
        return true;
      }

      const grant = await this.prisma.moduleAccessGrant.findUnique({
        where: {
          employeeId_module: { employeeId: user.userId, module: requiredModule },
        },
      });
      if (grant) return true;
    }

    return false;
  }
}
