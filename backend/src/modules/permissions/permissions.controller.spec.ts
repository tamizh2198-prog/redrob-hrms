import { Role } from '@prisma/client';
import { PermissionsController } from './permissions.controller';
import { PermissionsService } from './permissions.service';
import { ROLES_KEY } from '../../shared/rbac/roles.decorator';

function createMockService() {
  return {
    listRoles: jest.fn(),
    listPermissions: jest.fn(),
    getRolePermissions: jest.fn(),
    updateRolePermissions: jest.fn(),
  };
}

describe('PermissionsController (Auth Phase 5: Roles & Permissions)', () => {
  let service: ReturnType<typeof createMockService>;
  let controller: PermissionsController;

  beforeEach(() => {
    service = createMockService();
    controller = new PermissionsController(
      service as unknown as PermissionsService,
    );
  });

  // Requirements 5-7 (HR_ADMIN/MANAGER/EMPLOYEE receive 403): enforced by
  // the existing global RolesGuard reading this exact @Roles() metadata
  // (already generically proven in roles.guard.spec.ts). This test proves
  // the controller is wired to require SUPER_ADMIN — every route on this
  // controller inherits it, since the decorator is applied at class level.
  it('declares @Roles(Role.SUPER_ADMIN) on the whole controller', () => {
    const requiredRoles = Reflect.getMetadata(ROLES_KEY, PermissionsController);
    expect(requiredRoles).toEqual([Role.SUPER_ADMIN]);
  });

  it('listRoles delegates to the service', () => {
    service.listRoles.mockReturnValue([{ role: Role.EMPLOYEE }]);
    expect(controller.listRoles()).toEqual([{ role: Role.EMPLOYEE }]);
  });

  it('listPermissions delegates to the service', async () => {
    service.listPermissions.mockResolvedValue([]);
    await expect(controller.listPermissions()).resolves.toEqual([]);
  });

  it('getRolePermissions passes the :role param straight through — the service is the sole validator', async () => {
    service.getRolePermissions.mockResolvedValue({ role: 'MANAGER' });
    await controller.getRolePermissions('MANAGER');
    expect(service.getRolePermissions).toHaveBeenCalledWith('MANAGER');
  });

  // Self-escalation guard (requirement #8): the :role path param — not any
  // value in the request body — determines which role is targeted, and the
  // caller's own role/identity from CurrentUser/JWT is never consulted or
  // trusted for this decision. Combined with the controller-wide
  // SUPER_ADMIN requirement, a non-SUPER_ADMIN caller (including one
  // targeting their own role) is rejected by RolesGuard before this method
  // ever runs.
  it('updateRolePermissions forwards only the whitelisted DTO shape, never trusting extra body fields', async () => {
    service.updateRolePermissions.mockResolvedValue({ role: 'HR_ADMIN' });
    await controller.updateRolePermissions('HR_ADMIN', {
      permissionIds: ['p-1'],
    });
    expect(service.updateRolePermissions).toHaveBeenCalledWith('HR_ADMIN', {
      permissionIds: ['p-1'],
    });
  });
});
