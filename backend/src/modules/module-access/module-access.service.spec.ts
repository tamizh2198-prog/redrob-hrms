import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ModuleAccessService } from './module-access.service';
import { PrismaService } from '../../shared/database/prisma.service';

function createMockPrisma() {
  return {
    employee: { findUnique: jest.fn() },
    moduleAccessGrant: {
      upsert: jest.fn(),
      deleteMany: jest.fn(),
      findMany: jest.fn(),
    },
  };
}

describe('ModuleAccessService (Super Admin per-employee module access)', () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let service: ModuleAccessService;

  beforeEach(() => {
    prisma = createMockPrisma();
    service = new ModuleAccessService(prisma as unknown as PrismaService);
  });

  it('lists the fixed set of grantable modules', () => {
    expect(service.listModules()).toContain('ASSETS');
    expect(service.listModules()).toContain('HELPDESK');
    // Deliberately excluded — see module-access.constants.ts.
    expect(service.listModules()).not.toContain('EMPLOYEE');
    expect(service.listModules()).not.toContain('AUDIT');
  });

  describe('grant', () => {
    it('creates a grant recording who granted it', async () => {
      prisma.employee.findUnique.mockResolvedValue({ id: 'emp-1' });
      prisma.moduleAccessGrant.upsert.mockResolvedValue({
        id: 'grant-1',
        employeeId: 'emp-1',
        module: 'ASSETS',
        grantedBy: 'admin-1',
      });

      const result = await service.grant('emp-1', 'ASSETS', 'admin-1');

      expect(prisma.moduleAccessGrant.upsert).toHaveBeenCalledWith({
        where: { employeeId_module: { employeeId: 'emp-1', module: 'ASSETS' } },
        update: { grantedBy: 'admin-1' },
        create: { employeeId: 'emp-1', module: 'ASSETS', grantedBy: 'admin-1' },
      });
      expect(result.grantedBy).toBe('admin-1');
    });

    it('rejects granting access for an employee that does not exist', async () => {
      prisma.employee.findUnique.mockResolvedValue(null);

      await expect(
        service.grant('ghost', 'ASSETS', 'admin-1'),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.moduleAccessGrant.upsert).not.toHaveBeenCalled();
    });
  });

  describe('revoke', () => {
    it('deletes the grant for that employee+module', async () => {
      await service.revoke('emp-1', 'ASSETS');
      expect(prisma.moduleAccessGrant.deleteMany).toHaveBeenCalledWith({
        where: { employeeId: 'emp-1', module: 'ASSETS' },
      });
    });

    it('rejects an unknown module rather than silently no-op-ing', async () => {
      await expect(service.revoke('emp-1', 'NOT_A_MODULE')).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.moduleAccessGrant.deleteMany).not.toHaveBeenCalled();
    });
  });

  it('lists every grant currently held by an employee', async () => {
    prisma.moduleAccessGrant.findMany.mockResolvedValue([
      { id: 'g-1', module: 'ASSETS' },
      { id: 'g-2', module: 'HELPDESK' },
    ]);

    const result = await service.listForEmployee('emp-1');

    expect(prisma.moduleAccessGrant.findMany).toHaveBeenCalledWith({
      where: { employeeId: 'emp-1' },
      orderBy: { module: 'asc' },
    });
    expect(result).toHaveLength(2);
  });
});
