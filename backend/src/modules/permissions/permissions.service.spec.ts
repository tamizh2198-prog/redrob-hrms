import { BadRequestException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { PermissionsService } from './permissions.service';
import { PrismaService } from '../../shared/database/prisma.service';

function createMockPrisma() {
  return {
    permission: {
      findMany: jest.fn(),
    },
    rolePermission: {
      findMany: jest.fn(),
      count: jest.fn(),
      deleteMany: jest.fn(),
      createMany: jest.fn(),
    },
    $transaction: jest.fn((ops: unknown[]) => Promise.all(ops)),
  };
}

describe('PermissionsService (Auth Phase 5: Roles & Permissions)', () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let service: PermissionsService;

  beforeEach(() => {
    prisma = createMockPrisma();
    service = new PermissionsService(prisma as unknown as PrismaService);
  });

  describe('listRoles', () => {
    it('returns all five existing Role enum values, unmodified', () => {
      const result = service.listRoles();
      expect(result).toEqual([
        { role: Role.EMPLOYEE },
        { role: Role.MANAGER },
        { role: Role.HR_ADMIN },
        { role: Role.SUPER_ADMIN },
        { role: Role.HR_ASSOCIATE },
      ]);
    });
  });

  describe('listPermissions', () => {
    it('delegates to prisma.permission.findMany', async () => {
      prisma.permission.findMany.mockResolvedValue([
        { id: 'p-1', key: 'employee.view' },
      ]);
      const result = await service.listPermissions();
      expect(result).toEqual([{ id: 'p-1', key: 'employee.view' }]);
      expect(prisma.permission.findMany).toHaveBeenCalled();
    });
  });

  describe('getRolePermissions', () => {
    it('marks catalog permissions as enabled/disabled for the given role', async () => {
      prisma.permission.findMany.mockResolvedValue([
        { id: 'p-1', key: 'employee.view' },
        { id: 'p-2', key: 'employee.delete' },
      ]);
      prisma.rolePermission.findMany.mockResolvedValue([
        { permissionId: 'p-1' },
      ]);

      const result = await service.getRolePermissions('MANAGER');

      expect(result.role).toBe('MANAGER');
      expect(result.editable).toBe(true);
      expect(result.permissions).toEqual([
        { id: 'p-1', key: 'employee.view', enabled: true },
        { id: 'p-2', key: 'employee.delete', enabled: false },
      ]);
    });

    it('marks SUPER_ADMIN as not editable', async () => {
      prisma.permission.findMany.mockResolvedValue([]);
      prisma.rolePermission.findMany.mockResolvedValue([]);
      const result = await service.getRolePermissions('SUPER_ADMIN');
      expect(result.editable).toBe(false);
    });

    it('rejects an unknown role string', async () => {
      await expect(service.getRolePermissions('NOT_A_ROLE')).rejects.toThrow(
        BadRequestException,
      );
    });

    describe('HR_ASSOCIATE (Roles & Permissions UI)', () => {
      it('shows the real RolesGuard-enforced module access instead of the dormant catalog, and is not editable', async () => {
        const result = await service.getRolePermissions('HR_ASSOCIATE');

        expect(result.editable).toBe(false);
        // Never touches the Permission/RolePermission catalog for this role —
        // its access isn't governed by that table at all.
        expect(prisma.permission.findMany).not.toHaveBeenCalled();
        expect(prisma.rolePermission.findMany).not.toHaveBeenCalled();

        const enabled = result.permissions.filter((p) => p.enabled).map((p) => p.name);
        expect(enabled).toEqual(['Onboarding', 'Offboarding', 'Assets']);

        const disabled = result.permissions.filter((p) => !p.enabled).map((p) => p.name);
        expect(disabled).toEqual([
          'Employee Directory',
          'CTC / Salary',
          'Create Leave Type',
          'Roles & Permissions',
          'Audit Logs',
          'Recruitment (ATS)',
        ]);
      });
    });
  });

  describe('updateRolePermissions — security', () => {
    it('rejects any attempt to modify SUPER_ADMIN permissions', async () => {
      await expect(
        service.updateRolePermissions('SUPER_ADMIN', {
          permissionIds: ['p-1'],
        }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejects an invalid role parameter', async () => {
      await expect(
        service.updateRolePermissions('LEADERSHIP', { permissionIds: [] }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects any attempt to modify HR_ASSOCIATE permissions — access is granted by RolesGuard, not this catalog', async () => {
      await expect(
        service.updateRolePermissions('HR_ASSOCIATE', {
          permissionIds: ['p-1'],
        }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejects permission ids that do not exist in the catalog', async () => {
      prisma.permission.findMany.mockResolvedValue([{ id: 'p-1' }]);
      await expect(
        service.updateRolePermissions('HR_ADMIN', {
          permissionIds: ['p-1', 'fake-id-does-not-exist'],
        }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('updateRolePermissions — happy path', () => {
    it('replaces the role permission set inside a transaction', async () => {
      prisma.permission.findMany
        .mockResolvedValueOnce([{ id: 'p-1' }, { id: 'p-2' }]) // existence check
        .mockResolvedValueOnce([
          { id: 'p-1', key: 'employee.view' },
          { id: 'p-2', key: 'leave.view' },
        ]); // getRolePermissions catalog
      prisma.rolePermission.findMany.mockResolvedValue([
        { permissionId: 'p-1' },
        { permissionId: 'p-2' },
      ]);

      const result = await service.updateRolePermissions('MANAGER', {
        permissionIds: ['p-1', 'p-2'],
      });

      expect(prisma.rolePermission.deleteMany).toHaveBeenCalledWith({
        where: { role: 'MANAGER' },
      });
      expect(prisma.rolePermission.createMany).toHaveBeenCalledWith({
        data: [
          { role: 'MANAGER', permissionId: 'p-1' },
          { role: 'MANAGER', permissionId: 'p-2' },
        ],
      });
      expect(result.role).toBe('MANAGER');
    });

    it('deduplicates repeated permission ids in the request body', async () => {
      prisma.permission.findMany
        .mockResolvedValueOnce([{ id: 'p-1' }])
        .mockResolvedValueOnce([]);
      prisma.rolePermission.findMany.mockResolvedValue([]);

      await service.updateRolePermissions('EMPLOYEE', {
        permissionIds: ['p-1', 'p-1', 'p-1'],
      });

      expect(prisma.rolePermission.createMany).toHaveBeenCalledWith({
        data: [{ role: 'EMPLOYEE', permissionId: 'p-1' }],
      });
    });
  });
});
