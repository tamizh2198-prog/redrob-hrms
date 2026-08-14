import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from './role.enum';
import { ROLES_KEY } from './roles.decorator';
import { MODULE_KEY } from './requires-module.decorator';
import { AuthenticatedRequest } from '../auth/authenticated-request.interface';
import { PrismaService } from '../database/prisma.service';

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
