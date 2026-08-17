import { Reflector } from '@nestjs/core';
import { ExecutionContext } from '@nestjs/common';
import { Role } from '@prisma/client';
import { RolesGuard } from './roles.guard';
import { PrismaService } from '../database/prisma.service';

function createMockPrisma() {
  return { moduleAccessGrant: { findUnique: jest.fn() } };
}

function createMockContext(
  user: { userId: string; role: string } | undefined,
  requiredRoles?: Role[],
  requiredModule?: string,
) {
  const reflector = {
    getAllAndOverride: jest
      .fn()
      .mockReturnValueOnce(requiredRoles)
      .mockReturnValueOnce(requiredModule),
  };
  const context = {
    getHandler: jest.fn(),
    getClass: jest.fn(),
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
  return { context, reflector };
}

describe('RolesGuard (Auth Phase 1: Super Admin authorization)', () => {
  let prisma: ReturnType<typeof createMockPrisma>;

  beforeEach(() => {
    prisma = createMockPrisma();
  });

  it('allows any authenticated user when no @Roles are declared on the route', async () => {
    const { context, reflector } = createMockContext(
      { userId: 'u-1', role: 'EMPLOYEE' },
      undefined,
    );
    const guard = new RolesGuard(
      reflector as unknown as Reflector,
      prisma as unknown as PrismaService,
    );
    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it('allows a SUPER_ADMIN through a route requiring SUPER_ADMIN', async () => {
    const { context, reflector } = createMockContext(
      { userId: 'admin-1', role: 'SUPER_ADMIN' },
      [Role.SUPER_ADMIN],
    );
    const guard = new RolesGuard(
      reflector as unknown as Reflector,
      prisma as unknown as PrismaService,
    );
    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it('rejects a non-SUPER_ADMIN authenticated user on a SUPER_ADMIN-only route', async () => {
    const { context, reflector } = createMockContext(
      { userId: 'hr-1', role: 'HR_ADMIN' },
      [Role.SUPER_ADMIN],
    );
    const guard = new RolesGuard(
      reflector as unknown as Reflector,
      prisma as unknown as PrismaService,
    );
    await expect(guard.canActivate(context)).resolves.toBe(false);
  });

  it('rejects when there is no authenticated user at all', async () => {
    const { context, reflector } = createMockContext(undefined, [
      Role.SUPER_ADMIN,
    ]);
    const guard = new RolesGuard(
      reflector as unknown as Reflector,
      prisma as unknown as PrismaService,
    );
    await expect(guard.canActivate(context)).resolves.toBe(false);
  });

  describe('This task: @RequiresModule() grants a role-mismatched caller through for that module only', () => {
    it('admits a caller with no matching role but an active grant for the tagged module', async () => {
      const { context, reflector } = createMockContext(
        { userId: 'emp-1', role: 'EMPLOYEE' },
        [Role.HR_ADMIN, Role.SUPER_ADMIN],
        'ASSETS',
      );
      prisma.moduleAccessGrant.findUnique.mockResolvedValue({
        id: 'grant-1',
        employeeId: 'emp-1',
        module: 'ASSETS',
      });
      const guard = new RolesGuard(
        reflector as unknown as Reflector,
        prisma as unknown as PrismaService,
      );

      await expect(guard.canActivate(context)).resolves.toBe(true);
      expect(prisma.moduleAccessGrant.findUnique).toHaveBeenCalledWith({
        where: { employeeId_module: { employeeId: 'emp-1', module: 'ASSETS' } },
      });
    });

    it('still rejects when the caller has no grant for the tagged module', async () => {
      const { context, reflector } = createMockContext(
        { userId: 'emp-1', role: 'EMPLOYEE' },
        [Role.HR_ADMIN, Role.SUPER_ADMIN],
        'ASSETS',
      );
      prisma.moduleAccessGrant.findUnique.mockResolvedValue(null);
      const guard = new RolesGuard(
        reflector as unknown as Reflector,
        prisma as unknown as PrismaService,
      );

      await expect(guard.canActivate(context)).resolves.toBe(false);
    });

    it('never checks for a grant when the route has no @RequiresModule() tag', async () => {
      const { context, reflector } = createMockContext(
        { userId: 'emp-1', role: 'EMPLOYEE' },
        [Role.HR_ADMIN, Role.SUPER_ADMIN],
        undefined,
      );
      const guard = new RolesGuard(
        reflector as unknown as Reflector,
        prisma as unknown as PrismaService,
      );

      await expect(guard.canActivate(context)).resolves.toBe(false);
      expect(prisma.moduleAccessGrant.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('Phase 2: HR_ASSOCIATE static role-default module access', () => {
    it.each(['ONBOARDING', 'OFFBOARDING', 'ASSETS'])(
      'admits an HR_ASSOCIATE into a route requiring HR_ADMIN/SUPER_ADMIN when the route is tagged @RequiresModule(%s)',
      async (module) => {
        const { context, reflector } = createMockContext(
          { userId: 'hra-1', role: 'HR_ASSOCIATE' },
          [Role.HR_ADMIN, Role.SUPER_ADMIN],
          module,
        );
        const guard = new RolesGuard(
          reflector as unknown as Reflector,
          prisma as unknown as PrismaService,
        );

        await expect(guard.canActivate(context)).resolves.toBe(true);
        // Role-based default is a static, synchronous check — it must never
        // fall through to (or depend on) the per-employee grant lookup.
        expect(prisma.moduleAccessGrant.findUnique).not.toHaveBeenCalled();
      },
    );

    it('does not admit HR_ASSOCIATE into a module outside its fixed default set', async () => {
      const { context, reflector } = createMockContext(
        { userId: 'hra-1', role: 'HR_ASSOCIATE' },
        [Role.HR_ADMIN, Role.SUPER_ADMIN],
        'ANALYTICS',
      );
      prisma.moduleAccessGrant.findUnique.mockResolvedValue(null);
      const guard = new RolesGuard(
        reflector as unknown as Reflector,
        prisma as unknown as PrismaService,
      );

      await expect(guard.canActivate(context)).resolves.toBe(false);
      // Falls through to the existing per-employee grant path, same as any
      // other role — HR_ASSOCIATE is not a blanket module bypass.
      expect(prisma.moduleAccessGrant.findUnique).toHaveBeenCalledWith({
        where: { employeeId_module: { employeeId: 'hra-1', module: 'ANALYTICS' } },
      });
    });

    it('still rejects HR_ASSOCIATE outright on a route with no @RequiresModule() tag at all (e.g. Leave Type management)', async () => {
      const { context, reflector } = createMockContext(
        { userId: 'hra-1', role: 'HR_ASSOCIATE' },
        [Role.HR_ADMIN, Role.SUPER_ADMIN],
        undefined,
      );
      const guard = new RolesGuard(
        reflector as unknown as Reflector,
        prisma as unknown as PrismaService,
      );

      await expect(guard.canActivate(context)).resolves.toBe(false);
      expect(prisma.moduleAccessGrant.findUnique).not.toHaveBeenCalled();
    });

    it('does not change behavior for other roles on a @RequiresModule()-tagged route (e.g. MANAGER still needs an explicit grant)', async () => {
      const { context, reflector } = createMockContext(
        { userId: 'mgr-1', role: 'MANAGER' },
        [Role.HR_ADMIN, Role.SUPER_ADMIN],
        'ONBOARDING',
      );
      prisma.moduleAccessGrant.findUnique.mockResolvedValue(null);
      const guard = new RolesGuard(
        reflector as unknown as Reflector,
        prisma as unknown as PrismaService,
      );

      await expect(guard.canActivate(context)).resolves.toBe(false);
      expect(prisma.moduleAccessGrant.findUnique).toHaveBeenCalled();
    });
  });
});
