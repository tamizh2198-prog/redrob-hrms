import { Reflector } from '@nestjs/core';
import { ExecutionContext } from '@nestjs/common';
import { Role } from '@prisma/client';
import { RolesGuard } from './roles.guard';

function createMockContext(
  user: { userId: string; role: string } | undefined,
  requiredRoles?: Role[],
) {
  const reflector = {
    getAllAndOverride: jest.fn().mockReturnValue(requiredRoles),
  };
  const context = {
    getHandler: jest.fn(),
    getClass: jest.fn(),
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
  return { context, reflector };
}

describe('RolesGuard (Auth Phase 1: Super Admin authorization)', () => {
  it('allows any authenticated user when no @Roles are declared on the route', () => {
    const { context, reflector } = createMockContext(
      { userId: 'u-1', role: 'EMPLOYEE' },
      undefined,
    );
    const guard = new RolesGuard(reflector as unknown as Reflector);
    expect(guard.canActivate(context)).toBe(true);
  });

  it('allows a SUPER_ADMIN through a route requiring SUPER_ADMIN', () => {
    const { context, reflector } = createMockContext(
      { userId: 'admin-1', role: 'SUPER_ADMIN' },
      [Role.SUPER_ADMIN],
    );
    const guard = new RolesGuard(reflector as unknown as Reflector);
    expect(guard.canActivate(context)).toBe(true);
  });

  it('rejects a non-SUPER_ADMIN authenticated user on a SUPER_ADMIN-only route', () => {
    const { context, reflector } = createMockContext(
      { userId: 'hr-1', role: 'HR_ADMIN' },
      [Role.SUPER_ADMIN],
    );
    const guard = new RolesGuard(reflector as unknown as Reflector);
    expect(guard.canActivate(context)).toBe(false);
  });

  it('rejects when there is no authenticated user at all', () => {
    const { context, reflector } = createMockContext(undefined, [
      Role.SUPER_ADMIN,
    ]);
    const guard = new RolesGuard(reflector as unknown as Reflector);
    expect(guard.canActivate(context)).toBe(false);
  });
});
