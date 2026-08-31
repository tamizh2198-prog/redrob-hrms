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

  it('allows an HR_ASSOCIATE through a route that lists HR_ASSOCIATE alongside HR_ADMIN', async () => {
    const { context, reflector } = createMockContext(
      { userId: 'ha-1', role: 'HR_ASSOCIATE' },
      [Role.HR_ADMIN, Role.HR_ASSOCIATE, Role.SUPER_ADMIN],
    );
    const guard = new RolesGuard(
      reflector as unknown as Reflector,
      prisma as unknown as PrismaService,
    );
    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it('rejects an HR_ASSOCIATE on a route that deliberately excludes it (e.g. an approve/reject action)', async () => {
    const { context, reflector } = createMockContext(
      { userId: 'ha-1', role: 'HR_ASSOCIATE' },
      [Role.HR_ADMIN, Role.SUPER_ADMIN],
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
