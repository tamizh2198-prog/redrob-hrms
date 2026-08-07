import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { OffboardingService } from './offboarding.service';
import { PrismaService } from '../../shared/database/prisma.service';
import { NotificationService } from '../../shared/notifications/notification.service';
import { LeaveService } from '../leave/leave.service';
import { AssetsService } from '../assets/assets.service';

function createMockPrisma() {
  return {
    employee: { findUnique: jest.fn(), update: jest.fn() },
    resignation: {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
    },
    lwdAdjustment: { create: jest.fn() },
    clearanceItem: {
      findUnique: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
      findMany: jest.fn(),
    },
    exitInterview: { upsert: jest.fn() },
    finalSettlement: {
      findUnique: jest.fn(),
      update: jest.fn(),
      upsert: jest.fn(),
    },
    employeeHistory: { create: jest.fn() },
    $transaction: jest.fn((ops: unknown[]) => Promise.all(ops)),
  };
}

function createMockNotifications() {
  return { send: jest.fn().mockResolvedValue(undefined) };
}

function createMockLeaveService() {
  return { getBalances: jest.fn() };
}

function createMockAssetsService() {
  return {
    hasUnreturnedAssets: jest.fn(),
    getRecoverableAssetCost: jest.fn(),
  };
}

describe('OffboardingService', () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let notifications: ReturnType<typeof createMockNotifications>;
  let leaveService: ReturnType<typeof createMockLeaveService>;
  let assetsService: ReturnType<typeof createMockAssetsService>;
  let service: OffboardingService;

  beforeEach(() => {
    prisma = createMockPrisma();
    notifications = createMockNotifications();
    leaveService = createMockLeaveService();
    assetsService = createMockAssetsService();
    service = new OffboardingService(
      prisma as unknown as PrismaService,
      notifications as unknown as NotificationService,
      leaveService as unknown as LeaveService,
      assetsService as unknown as AssetsService,
    );
  });

  describe('Acceptance Criteria: last working day is correctly computed from the notice period', () => {
    it('computes LWD as submission date + notice period days', async () => {
      prisma.employee.findUnique.mockResolvedValue({
        id: 'emp-1',
        reportingManagerId: 'mgr-1',
      });
      prisma.resignation.create.mockImplementation(({ data }) =>
        Promise.resolve({ id: 'res-1', ...data }),
      );

      const result = await service.submitResignation(
        { noticePeriodDays: 30 },
        'emp-1',
        Role.EMPLOYEE,
      );

      const expectedDays = Math.round(
        (result.lastWorkingDay.getTime() - result.submittedDate.getTime()) /
          (24 * 60 * 60 * 1000),
      );
      expect(expectedDays).toBe(30);
      expect(prisma.resignation.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            clearanceItems: {
              create: [
                { department: 'IT' },
                { department: 'FINANCE' },
                { department: 'ADMIN' },
                { department: 'HR' },
              ],
            },
          }),
        }),
      );
    });

    it("rejects an employee submitting a resignation on someone else's behalf", async () => {
      await expect(
        service.submitResignation(
          { employeeId: 'emp-2', noticePeriodDays: 30 },
          'emp-1',
          Role.EMPLOYEE,
        ),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('Acceptance Criteria: IT Clearance is blocked while unreturned assets exist', () => {
    it('rejects IT sign-off while the employee still has an unreturned asset', async () => {
      prisma.clearanceItem.findUnique.mockResolvedValue({
        id: 'item-1',
        status: 'PENDING',
        department: 'IT',
        resignationId: 'res-1',
        resignation: { employeeId: 'emp-1' },
      });
      assetsService.hasUnreturnedAssets.mockResolvedValue(true);

      await expect(
        service.signoffClearance('item-1', {}, 'hr-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('signs off IT clearance once all assets are returned', async () => {
      prisma.clearanceItem.findUnique.mockResolvedValue({
        id: 'item-1',
        status: 'PENDING',
        department: 'IT',
        resignationId: 'res-1',
        resignation: { employeeId: 'emp-1' },
      });
      assetsService.hasUnreturnedAssets.mockResolvedValue(false);
      prisma.clearanceItem.update.mockResolvedValue({
        id: 'item-1',
        status: 'SIGNED_OFF',
      });
      prisma.clearanceItem.count.mockResolvedValue(3); // other departments still pending

      const result = await service.signoffClearance('item-1', {}, 'hr-1');
      expect(result.status).toBe('SIGNED_OFF');
      expect(prisma.resignation.update).not.toHaveBeenCalled();
    });

    it('flips the resignation to CLEARED once the last department signs off', async () => {
      prisma.clearanceItem.findUnique.mockResolvedValue({
        id: 'item-4',
        status: 'PENDING',
        department: 'HR',
        resignationId: 'res-1',
        resignation: { employeeId: 'emp-1' },
      });
      prisma.clearanceItem.update.mockResolvedValue({
        id: 'item-4',
        status: 'SIGNED_OFF',
      });
      prisma.clearanceItem.count.mockResolvedValue(0);
      prisma.resignation.update.mockResolvedValue({});

      await service.signoffClearance('item-4', {}, 'hr-1');
      expect(prisma.resignation.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'CLEARED' } }),
      );
    });
  });

  describe('Acceptance Criteria: relieving letter generation is blocked until all clearance items are signed off', () => {
    it('rejects letter generation while any department is still pending', async () => {
      prisma.resignation.findUnique.mockResolvedValue({
        id: 'res-1',
        employeeId: 'emp-1',
      });
      prisma.clearanceItem.findMany.mockResolvedValue([
        { department: 'IT', status: 'SIGNED_OFF' },
        { department: 'FINANCE', status: 'PENDING' },
        { department: 'ADMIN', status: 'SIGNED_OFF' },
        { department: 'HR', status: 'SIGNED_OFF' },
      ]);

      await expect(service.generateLetters('res-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('generates both letters once every department has signed off', async () => {
      prisma.resignation.findUnique.mockResolvedValue({
        id: 'res-1',
        employeeId: 'emp-1',
      });
      prisma.clearanceItem.findMany.mockResolvedValue([
        { department: 'IT', status: 'SIGNED_OFF' },
        { department: 'FINANCE', status: 'SIGNED_OFF' },
        { department: 'ADMIN', status: 'SIGNED_OFF' },
        { department: 'HR', status: 'SIGNED_OFF' },
      ]);
      prisma.resignation.update.mockResolvedValue({
        relievingLetterRef: 'relieving-letter-res-1.pdf',
        experienceLetterRef: 'experience-letter-res-1.pdf',
      });

      const result = await service.generateLetters('res-1');
      expect(result.relievingLetterRef).toBe('relieving-letter-res-1.pdf');
      expect(notifications.send).toHaveBeenCalledWith(
        expect.objectContaining({
          recipientId: 'emp-1',
          template: 'offboarding.relieving-letter-generated',
        }),
      );
    });
  });

  describe('Acceptance Criteria: F&F correctly nets leave encashment, notice shortfall, and unreturned-asset recovery with no manual re-entry', () => {
    it('pulls leave balance and asset cost automatically and nets them against notice shortfall', async () => {
      // Notice period was 30 days but the employee actually left 10 days
      // early — a 10-day shortfall.
      const submittedDate = new Date('2027-01-01T00:00:00.000Z');
      const lastWorkingDay = new Date('2027-01-21T00:00:00.000Z'); // 20 days served, not 30
      prisma.resignation.findUnique.mockResolvedValue({
        id: 'res-1',
        employeeId: 'emp-1',
        submittedDate,
        noticePeriodDays: 30,
        lastWorkingDay,
      });
      leaveService.getBalances.mockResolvedValue([
        { leaveType: { isEncashable: true }, available: 8 },
        { leaveType: { isEncashable: false }, available: 5 }, // not encashable — excluded
      ]);
      assetsService.getRecoverableAssetCost.mockResolvedValue(15000);
      prisma.finalSettlement.upsert.mockImplementation(({ create }) =>
        Promise.resolve(create),
      );

      const result = await service.computeSettlement('res-1', {
        perDayPayRate: 2000,
        pendingSalary: 50000,
      });

      // leaveEncashment = 8 days * 2000 = 16000 (only the encashable type counted)
      // noticeRecovery = 10 shortfall days * 2000 = 20000
      // assetRecovery = 15000 (pulled straight from AssetsService, untouched)
      // netPayable = 50000 + 16000 - 20000 - 15000 = 31000
      expect(result.leaveEncashment).toBe(16000);
      expect(result.noticeRecovery).toBe(20000);
      expect(result.assetRecovery).toBe(15000);
      expect(result.netPayable).toBe(31000);
    });

    it('applies zero notice recovery when the employee served the full notice period', async () => {
      const submittedDate = new Date('2027-01-01T00:00:00.000Z');
      const lastWorkingDay = new Date('2027-01-31T00:00:00.000Z'); // full 30 days served
      prisma.resignation.findUnique.mockResolvedValue({
        id: 'res-1',
        employeeId: 'emp-1',
        submittedDate,
        noticePeriodDays: 30,
        lastWorkingDay,
      });
      leaveService.getBalances.mockResolvedValue([]);
      assetsService.getRecoverableAssetCost.mockResolvedValue(0);
      prisma.finalSettlement.upsert.mockImplementation(({ create }) =>
        Promise.resolve(create),
      );

      const result = await service.computeSettlement('res-1', {
        perDayPayRate: 2000,
      });
      expect(result.noticeRecovery).toBe(0);
    });
  });

  describe("Business Rule: Employee status moves to 'Archived' only after F&F is marked paid", () => {
    it('rejects marking paid before the settlement is approved', async () => {
      prisma.finalSettlement.findUnique.mockResolvedValue({
        status: 'PENDING_APPROVAL',
      });

      await expect(
        service.markSettlementPaid('res-1', {}, 'hr-1'),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.employee.update).not.toHaveBeenCalled();
    });

    it('archives the employee once the settlement is marked paid', async () => {
      prisma.finalSettlement.findUnique.mockResolvedValue({
        status: 'APPROVED',
      });
      prisma.resignation.findUnique.mockResolvedValue({
        id: 'res-1',
        employeeId: 'emp-1',
        rehireEligible: true,
      });
      prisma.employee.findUnique.mockResolvedValue({
        id: 'emp-1',
        status: 'ACTIVE',
      });

      await service.markSettlementPaid('res-1', {}, 'hr-1');

      expect(prisma.employee.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'ARCHIVED' } }),
      );
      expect(prisma.employeeHistory.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            oldValue: 'ACTIVE',
            newValue: 'ARCHIVED',
          }),
        }),
      );
    });
  });

  describe('LWD negotiation audit trail', () => {
    it("rejects an adjustment from someone who isn't the manager or HR", async () => {
      prisma.resignation.findUnique.mockResolvedValue({
        id: 'res-1',
        lastWorkingDay: new Date('2027-01-31'),
        employee: { reportingManagerId: 'mgr-real' },
      });

      await expect(
        service.adjustLwd(
          'res-1',
          { newDate: '2027-01-20', reason: 'Early release' },
          'mgr-imposter',
          Role.MANAGER,
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('records the previous and new date on the audit row when the real manager adjusts it', async () => {
      const previousDate = new Date('2027-01-31T00:00:00.000Z');
      prisma.resignation.findUnique.mockResolvedValue({
        id: 'res-1',
        lastWorkingDay: previousDate,
        employee: { reportingManagerId: 'mgr-1' },
      });
      prisma.resignation.update.mockResolvedValue({ id: 'res-1' });

      await service.adjustLwd(
        'res-1',
        { newDate: '2027-01-20', reason: 'Early release' },
        'mgr-1',
        Role.MANAGER,
      );

      expect(prisma.lwdAdjustment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            previousDate,
            reason: 'Early release',
            adjustedBy: 'mgr-1',
          }),
        }),
      );
    });
  });
});
