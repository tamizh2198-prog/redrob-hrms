import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { CLEARANCE_ITEMS, OffboardingService } from './offboarding.service';
import { PrismaService } from '../../shared/database/prisma.service';
import { NotificationService } from '../../shared/notifications/notification.service';
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

function createMockAssetsService() {
  return {
    hasUnreturnedAssets: jest.fn(),
    getRecoverableAssetCost: jest.fn(),
  };
}

describe('OffboardingService', () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let notifications: ReturnType<typeof createMockNotifications>;
  let assetsService: ReturnType<typeof createMockAssetsService>;
  let service: OffboardingService;

  beforeEach(() => {
    prisma = createMockPrisma();
    notifications = createMockNotifications();
    assetsService = createMockAssetsService();
    service = new OffboardingService(
      prisma as unknown as PrismaService,
      notifications as unknown as NotificationService,
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
              create: CLEARANCE_ITEMS.map(({ key, label, category }) => ({
                key,
                label,
                category,
              })),
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

  describe('Acceptance Criteria: the OFFICE_EQUIPMENT checklist item is blocked while unreturned assets exist', () => {
    it('rejects sign-off while the employee still has an unreturned asset', async () => {
      prisma.clearanceItem.findUnique.mockResolvedValue({
        id: 'item-1',
        status: 'PENDING',
        key: 'OFFICE_EQUIPMENT',
        category: 'LEAD_VERIFICATION',
        resignationId: 'res-1',
        resignation: {
          employeeId: 'emp-1',
          employee: { reportingManagerId: 'mgr-1' },
        },
      });
      assetsService.hasUnreturnedAssets.mockResolvedValue(true);

      await expect(
        service.signoffClearance('item-1', {}, 'hr-1', Role.HR_ADMIN),
      ).rejects.toThrow(BadRequestException);
    });

    it('signs off once all assets are returned', async () => {
      prisma.clearanceItem.findUnique.mockResolvedValue({
        id: 'item-1',
        status: 'PENDING',
        key: 'OFFICE_EQUIPMENT',
        category: 'LEAD_VERIFICATION',
        resignationId: 'res-1',
        resignation: {
          employeeId: 'emp-1',
          employee: { reportingManagerId: 'mgr-1' },
        },
      });
      assetsService.hasUnreturnedAssets.mockResolvedValue(false);
      prisma.clearanceItem.update.mockResolvedValue({
        id: 'item-1',
        status: 'SIGNED_OFF',
      });
      prisma.clearanceItem.count.mockResolvedValue(3); // other items still pending

      const result = await service.signoffClearance(
        'item-1',
        {},
        'mgr-1',
        Role.MANAGER,
      );
      expect(result.status).toBe('SIGNED_OFF');
      expect(prisma.resignation.update).not.toHaveBeenCalled();
    });

    it('flips the resignation to CLEARED once the last item signs off', async () => {
      prisma.clearanceItem.findUnique.mockResolvedValue({
        id: 'item-last',
        status: 'PENDING',
        key: 'TAX_PAPERS',
        category: 'EMPLOYEE_DECLARATION',
        resignationId: 'res-1',
        resignation: {
          employeeId: 'emp-1',
          employee: { reportingManagerId: 'mgr-1' },
        },
      });
      prisma.clearanceItem.update.mockResolvedValue({
        id: 'item-last',
        status: 'SIGNED_OFF',
      });
      prisma.clearanceItem.count.mockResolvedValue(0);
      prisma.resignation.update.mockResolvedValue({});

      await service.signoffClearance('item-last', {}, 'emp-1', Role.EMPLOYEE);
      expect(prisma.resignation.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'CLEARED' } }),
      );
    });
  });

  describe('Acceptance Criteria: clearance checklist RBAC matches the two checklist sections', () => {
    it("rejects a LEAD_VERIFICATION item sign-off from someone who isn't the employee's manager", async () => {
      prisma.clearanceItem.findUnique.mockResolvedValue({
        id: 'item-1',
        status: 'PENDING',
        key: 'ID_CARD',
        category: 'LEAD_VERIFICATION',
        resignationId: 'res-1',
        resignation: {
          employeeId: 'emp-1',
          employee: { reportingManagerId: 'mgr-real' },
        },
      });

      await expect(
        service.signoffClearance('item-1', {}, 'mgr-imposter', Role.MANAGER),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rejects an EMPLOYEE_DECLARATION item confirmation from anyone but the exiting employee', async () => {
      prisma.clearanceItem.findUnique.mockResolvedValue({
        id: 'item-2',
        status: 'PENDING',
        key: 'FORWARDING_ADDRESS',
        category: 'EMPLOYEE_DECLARATION',
        resignationId: 'res-1',
        resignation: {
          employeeId: 'emp-1',
          employee: { reportingManagerId: 'mgr-1' },
        },
      });

      await expect(
        service.signoffClearance('item-2', {}, 'mgr-1', Role.MANAGER),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('Acceptance Criteria: relieving letter generation is blocked until all clearance items are signed off', () => {
    it('rejects letter generation while any checklist item is still pending', async () => {
      prisma.resignation.findUnique.mockResolvedValue({
        id: 'res-1',
        employeeId: 'emp-1',
      });
      const items = CLEARANCE_ITEMS.map((i) => ({
        ...i,
        status: 'SIGNED_OFF',
      }));
      items[1].status = 'PENDING';
      prisma.clearanceItem.findMany.mockResolvedValue(items);

      await expect(
        service.generateLetters('res-1', {}, 'hr-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('generates both letters and records who released them once every item has signed off', async () => {
      prisma.resignation.findUnique.mockResolvedValue({
        id: 'res-1',
        employeeId: 'emp-1',
      });
      prisma.clearanceItem.findMany.mockResolvedValue(
        CLEARANCE_ITEMS.map((i) => ({ ...i, status: 'SIGNED_OFF' })),
      );
      prisma.resignation.update.mockResolvedValue({
        relievingLetterRef: 'relieving-letter-res-1.pdf',
        experienceLetterRef: 'experience-letter-res-1.pdf',
      });

      const result = await service.generateLetters(
        'res-1',
        { closingRemarks: 'All clear' },
        'hr-1',
      );
      expect(result.relievingLetterRef).toBe('relieving-letter-res-1.pdf');
      expect(prisma.resignation.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            certificateReleasedBy: 'hr-1',
            closingRemarks: 'All clear',
          }),
        }),
      );
      expect(notifications.send).toHaveBeenCalledWith(
        expect.objectContaining({
          recipientId: 'emp-1',
          template: 'offboarding.relieving-letter-generated',
        }),
      );
    });
  });

  describe('Acceptance Criteria: F&F correctly nets notice shortfall and unreturned-asset recovery with no manual re-entry', () => {
    it('pulls asset cost automatically and nets it against notice shortfall (no leave encashment — Leave module removed)', async () => {
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
      assetsService.getRecoverableAssetCost.mockResolvedValue(15000);
      prisma.finalSettlement.upsert.mockImplementation(({ create }) =>
        Promise.resolve(create),
      );

      const result = await service.computeSettlement('res-1', {
        perDayPayRate: 2000,
        pendingSalary: 50000,
      });

      // leaveEncashment = 0 (Leave module removed)
      // noticeRecovery = 10 shortfall days * 2000 = 20000
      // assetRecovery = 15000 (pulled straight from AssetsService, untouched)
      // netPayable = 50000 + 0 - 20000 - 15000 = 15000
      expect(result.leaveEncashment).toBe(0);
      expect(result.noticeRecovery).toBe(20000);
      expect(result.assetRecovery).toBe(15000);
      expect(result.netPayable).toBe(15000);
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
