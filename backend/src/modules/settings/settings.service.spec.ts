import { BadRequestException, NotFoundException } from '@nestjs/common';
import { SettingsService } from './settings.service';
import { PrismaService } from '../../shared/database/prisma.service';
import { DefaultCompanyService } from '../../shared/database/default-company.service';

function createMockPrisma() {
  return {
    companySettings: {
      findUnique: jest.fn(),
      create: jest.fn(),
      upsert: jest.fn(),
    },
    department: {
      findMany: jest.fn(),
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    location: { findMany: jest.fn(), create: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
    designation: { findMany: jest.fn(), create: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
    grade: { findMany: jest.fn(), create: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
    integrationConfig: {
      findMany: jest.fn(),
      upsert: jest.fn(),
    },
  };
}

function createMockDefaultCompany() {
  return { getOrCreate: jest.fn().mockResolvedValue('company-1') };
}

describe('SettingsService', () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let defaultCompany: ReturnType<typeof createMockDefaultCompany>;
  let service: SettingsService;

  beforeEach(() => {
    prisma = createMockPrisma();
    defaultCompany = createMockDefaultCompany();
    service = new SettingsService(
      prisma as unknown as PrismaService,
      defaultCompany as unknown as DefaultCompanyService,
    );
  });

  describe('Section 7.17 Data Entities: CompanySettings', () => {
    it('creates a default row with sane defaults on first read', async () => {
      prisma.companySettings.findUnique.mockResolvedValue(null);
      prisma.companySettings.create.mockResolvedValue({ companyId: 'company-1' });

      await service.getCompanySettings();

      expect(prisma.companySettings.create).toHaveBeenCalledWith({
        data: { companyId: 'company-1' },
      });
    });

    it('does not recreate an existing row', async () => {
      const existing = { companyId: 'company-1', timezone: 'Asia/Kolkata' };
      prisma.companySettings.findUnique.mockResolvedValue(existing);

      const result = await service.getCompanySettings();

      expect(result).toBe(existing);
      expect(prisma.companySettings.create).not.toHaveBeenCalled();
    });
  });

  describe('org structure', () => {
    it('rejects an unknown org unit type', async () => {
      await expect(
        service.createOrgUnit('bogus', { name: 'X', code: 'X' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('dispatches department creation to the Department delegate', async () => {
      prisma.department.create.mockResolvedValue({ id: 'dept-1' });

      await service.createOrgUnit('department', {
        name: 'Engineering',
        code: 'ENG',
        parentId: 'parent-1',
      });

      expect(prisma.department.create).toHaveBeenCalledWith({
        data: {
          companyId: 'company-1',
          name: 'Engineering',
          code: 'ENG',
          parentId: 'parent-1',
        },
      });
    });

    it('ignores parentId for non-department types', async () => {
      prisma.location.create.mockResolvedValue({ id: 'loc-1' });

      await service.createOrgUnit('location', {
        name: 'Chennai',
        code: 'MAA',
        parentId: 'should-be-ignored',
      });

      expect(prisma.location.create).toHaveBeenCalledWith({
        data: { companyId: 'company-1', name: 'Chennai', code: 'MAA' },
      });
    });

    it('throws NotFoundException when updating a unit that does not exist', async () => {
      prisma.grade.findUnique.mockResolvedValue(null);

      await expect(
        service.updateOrgUnit('grade', 'missing', { isActive: false }),
      ).rejects.toThrow(NotFoundException);
    });

    describe('Section 7.17 Business Rule: deactivating a unit with active employees requires explicit confirmation', () => {
      it('rejects deactivation without force when employees are still assigned', async () => {
        prisma.designation.findUnique.mockResolvedValue({
          isActive: true,
          employees: [{ id: 'emp-1' }],
        });

        await expect(
          service.updateOrgUnit('designation', 'des-1', { isActive: false }),
        ).rejects.toThrow(BadRequestException);
        expect(prisma.designation.update).not.toHaveBeenCalled();
      });

      it('allows deactivation with force even when employees are still assigned', async () => {
        prisma.designation.findUnique.mockResolvedValue({
          isActive: true,
          employees: [{ id: 'emp-1' }],
        });
        prisma.designation.update.mockResolvedValue({ id: 'des-1', isActive: false });

        await service.updateOrgUnit('designation', 'des-1', {
          isActive: false,
          force: true,
        });

        expect(prisma.designation.update).toHaveBeenCalledWith(
          expect.objectContaining({ data: expect.objectContaining({ isActive: false }) }),
        );
      });

      it('allows deactivation without force when no employees are assigned', async () => {
        prisma.location.findUnique.mockResolvedValue({ isActive: true, employees: [] });
        prisma.location.update.mockResolvedValue({ id: 'loc-1', isActive: false });

        await service.updateOrgUnit('location', 'loc-1', { isActive: false });

        expect(prisma.location.update).toHaveBeenCalled();
      });
    });
  });

  describe('Section 7.17 Data Entities: IntegrationConfig', () => {
    it('surfaces every integration type even before any row exists', async () => {
      prisma.integrationConfig.findMany.mockResolvedValue([]);

      const result = await service.listIntegrations();

      expect(result.length).toBeGreaterThan(0);
      expect(result.every((r: any) => r.status === 'NOT_CONFIGURED')).toBe(true);
    });

    it('rejects an unknown integration type', async () => {
      await expect(
        service.updateIntegration('BOGUS', { status: 'CONFIGURED' as any }),
      ).rejects.toThrow(BadRequestException);
    });

    it('upserts status/metadata for a known integration type', async () => {
      prisma.integrationConfig.upsert.mockResolvedValue({ type: 'SLACK', status: 'CONFIGURED' });

      await service.updateIntegration('SLACK', {
        status: 'CONFIGURED' as any,
        metadata: { webhookUrl: 'https://example.test/hook' },
      });

      expect(prisma.integrationConfig.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { companyId_type: { companyId: 'company-1', type: 'SLACK' } },
        }),
      );
    });
  });
});
