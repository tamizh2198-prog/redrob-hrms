import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { AssetsService } from './assets.service';
import { PrismaService } from '../../shared/database/prisma.service';
import { DefaultCompanyService } from '../../shared/database/default-company.service';
import { NotificationService } from '../../shared/notifications/notification.service';

function createMockPrisma() {
  return {
    asset: {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
    },
    assetAssignment: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findFirstOrThrow: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
    assetRequest: {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
    },
    employee: { findUnique: jest.fn() },
    $transaction: jest.fn((ops: unknown[]) => Promise.all(ops)),
  };
}

function createMockNotifications() {
  return { send: jest.fn().mockResolvedValue(undefined) };
}

function createMockDefaultCompany() {
  return { getOrCreate: jest.fn().mockResolvedValue('company-1') };
}

describe('AssetsService', () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let notifications: ReturnType<typeof createMockNotifications>;
  let defaultCompany: ReturnType<typeof createMockDefaultCompany>;
  let service: AssetsService;

  beforeEach(() => {
    prisma = createMockPrisma();
    notifications = createMockNotifications();
    defaultCompany = createMockDefaultCompany();
    service = new AssetsService(
      prisma as unknown as PrismaService,
      defaultCompany as unknown as DefaultCompanyService,
      notifications as unknown as NotificationService,
    );
  });

  describe('Acceptance Criteria: an asset cannot show two active custodians simultaneously', () => {
    it('auto-closes the prior custody record when issuing to a new employee', async () => {
      prisma.asset.findUnique.mockResolvedValue({ id: 'asset-1' });
      prisma.assetAssignment.findFirst.mockResolvedValue({
        id: 'assignment-old',
        employeeId: 'emp-old',
      });
      prisma.assetAssignment.findFirstOrThrow.mockResolvedValue({
        id: 'assignment-new',
      });

      await service.issueAsset('asset-1', { employeeId: 'emp-new' });

      expect(prisma.assetAssignment.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'assignment-old' },
          data: expect.objectContaining({ returnedAt: expect.any(Date) }),
        }),
      );
      expect(prisma.assetAssignment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { assetId: 'asset-1', employeeId: 'emp-new' },
        }),
      );
    });

    it('does not attempt to close anything when the asset had no active custodian', async () => {
      prisma.asset.findUnique.mockResolvedValue({ id: 'asset-1' });
      prisma.assetAssignment.findFirst.mockResolvedValue(null);
      prisma.assetAssignment.findFirstOrThrow.mockResolvedValue({
        id: 'assignment-new',
      });

      await service.issueAsset('asset-1', { employeeId: 'emp-new' });

      expect(prisma.assetAssignment.update).not.toHaveBeenCalled();
    });
  });

  describe('Acceptance Criteria: asset issue requires recorded employee acknowledgement', () => {
    it('marks the asset Pending Handover (not Issued) right after issuing', async () => {
      prisma.asset.findUnique.mockResolvedValue({ id: 'asset-1' });
      prisma.assetAssignment.findFirst.mockResolvedValue(null);
      prisma.assetAssignment.findFirstOrThrow.mockResolvedValue({
        id: 'assignment-new',
      });

      await service.issueAsset('asset-1', { employeeId: 'emp-new' });

      expect(prisma.asset.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { status: 'PENDING_HANDOVER' },
        }),
      );
    });

    it('rejects acknowledgement from someone other than the receiving employee', async () => {
      prisma.assetAssignment.findUnique.mockResolvedValue({
        id: 'assignment-1',
        employeeId: 'emp-real',
        returnedAt: null,
      });

      await expect(
        service.acknowledgeAsset('assignment-1', 'emp-imposter'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('flips the asset to Issued once the receiving employee acknowledges', async () => {
      prisma.assetAssignment.findUnique.mockResolvedValue({
        id: 'assignment-1',
        assetId: 'asset-1',
        employeeId: 'emp-1',
        returnedAt: null,
      });
      prisma.assetAssignment.update.mockResolvedValue({ id: 'assignment-1' });
      prisma.asset.update.mockResolvedValue({ id: 'asset-1' });

      await service.acknowledgeAsset('assignment-1', 'emp-1');

      expect(prisma.asset.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'asset-1' },
          data: { status: 'ISSUED' },
        }),
      );
    });
  });

  describe('Return workflow', () => {
    it('rejects returning an asset with no active custodian', async () => {
      prisma.assetAssignment.findFirst.mockResolvedValue(null);

      await expect(service.returnAsset('asset-1', {})).rejects.toThrow(
        BadRequestException,
      );
    });

    it('returns the asset to the available pool and records the condition', async () => {
      prisma.assetAssignment.findFirst.mockResolvedValue({
        id: 'assignment-1',
      });
      prisma.assetAssignment.update.mockResolvedValue({});
      prisma.asset.update.mockResolvedValue({});

      await service.returnAsset('asset-1', {
        condition: 'DAMAGED',
        remarks: 'Cracked screen',
      });

      expect(prisma.asset.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { status: 'AVAILABLE', condition: 'DAMAGED' },
        }),
      );
    });
  });

  describe('Integration point: offboarding IT clearance / F&F recovery reads', () => {
    it('reports unreturned assets exist', async () => {
      prisma.assetAssignment.count.mockResolvedValue(2);
      await expect(service.hasUnreturnedAssets('emp-1')).resolves.toBe(true);
    });

    it('reports no unreturned assets', async () => {
      prisma.assetAssignment.count.mockResolvedValue(0);
      await expect(service.hasUnreturnedAssets('emp-1')).resolves.toBe(false);
    });

    it('sums the cost of unreturned and damaged assets for recovery', async () => {
      prisma.assetAssignment.findMany.mockResolvedValue([
        { asset: { cost: 50000 } },
        { asset: { cost: 20000 } },
        { asset: { cost: null } },
      ]);

      await expect(service.getRecoverableAssetCost('emp-1')).resolves.toBe(
        70000,
      );
    });
  });

  describe('Asset requests', () => {
    it('rejects a decision from someone who is neither the approver nor privileged', async () => {
      prisma.assetRequest.findUnique.mockResolvedValue({
        id: 'req-1',
        status: 'PENDING',
        approverId: 'mgr-1',
      });

      await expect(
        service.decideAssetRequest(
          'req-1',
          true,
          'someone-else',
          Role.EMPLOYEE,
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('lets HR Admin decide even when not the original approver', async () => {
      prisma.assetRequest.findUnique.mockResolvedValue({
        id: 'req-1',
        status: 'PENDING',
        approverId: 'mgr-1',
      });
      prisma.assetRequest.update.mockResolvedValue({ status: 'APPROVED' });

      await expect(
        service.decideAssetRequest('req-1', true, 'hr-1', Role.HR_ADMIN),
      ).resolves.toEqual({ status: 'APPROVED' });
    });
  });
});
