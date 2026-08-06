import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { ShiftService } from './shift.service';
import { PrismaService } from '../../shared/database/prisma.service';
import { DefaultCompanyService } from '../../shared/database/default-company.service';
import { NotificationService } from '../../shared/notifications/notification.service';

function createMockPrisma() {
  return {
    shift: { findUnique: jest.fn(), create: jest.fn(), findMany: jest.fn() },
    attendanceRecord: { findUnique: jest.fn() },
    rosterEntry: {
      upsert: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
    employee: { findUnique: jest.fn() },
    shiftSwapRequest: {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    $transaction: jest.fn((ops: unknown[]) => Promise.all(ops)),
  };
}

function createMockNotifications() {
  return { send: jest.fn().mockResolvedValue(undefined) };
}

function createMockDefaultCompany() {
  return { getOrCreate: jest.fn().mockResolvedValue('company-1') };
}

describe('ShiftService', () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let notifications: ReturnType<typeof createMockNotifications>;
  let defaultCompany: ReturnType<typeof createMockDefaultCompany>;
  let service: ShiftService;

  beforeEach(() => {
    prisma = createMockPrisma();
    notifications = createMockNotifications();
    defaultCompany = createMockDefaultCompany();
    service = new ShiftService(
      prisma as unknown as PrismaService,
      defaultCompany as unknown as DefaultCompanyService,
      notifications as unknown as NotificationService,
    );
  });

  describe('Business Rule: one active shift per date', () => {
    it('upserts the roster entry rather than creating duplicates', async () => {
      prisma.shift.findUnique.mockResolvedValue({ id: 'shift-1' });
      prisma.attendanceRecord.findUnique.mockResolvedValue(null);
      prisma.rosterEntry.upsert.mockResolvedValue({ id: 'roster-1' });

      const result = await service.assignRoster({
        employeeIds: ['emp-1'],
        dates: ['2026-03-01'],
        shiftId: 'shift-1',
      });

      expect(prisma.rosterEntry.upsert).toHaveBeenCalledTimes(1);
      expect(result.successCount).toBe(1);
    });
  });

  describe('Business Rule: shift swaps must be between same-department employees unless overridden', () => {
    it('rejects a cross-department swap without override', async () => {
      prisma.employee.findUnique
        .mockResolvedValueOnce({
          id: 'emp-1',
          departmentId: 'dept-A',
          reportingManagerId: 'mgr-1',
        })
        .mockResolvedValueOnce({ id: 'emp-2', departmentId: 'dept-B' });

      await expect(
        service.requestSwap(
          'emp-1',
          { counterpartId: 'emp-2', date: '2026-03-01' },
          Role.EMPLOYEE,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('allows a cross-department swap when HR Admin overrides', async () => {
      prisma.employee.findUnique
        .mockResolvedValueOnce({
          id: 'emp-1',
          departmentId: 'dept-A',
          reportingManagerId: 'mgr-1',
        })
        .mockResolvedValueOnce({ id: 'emp-2', departmentId: 'dept-B' });
      prisma.shiftSwapRequest.create.mockResolvedValue({ id: 'swap-1' });

      await expect(
        service.requestSwap(
          'emp-1',
          { counterpartId: 'emp-2', date: '2026-03-01', override: true },
          Role.HR_ADMIN,
        ),
      ).resolves.toBeDefined();
    });

    it('allows a same-department swap without override', async () => {
      prisma.employee.findUnique
        .mockResolvedValueOnce({
          id: 'emp-1',
          departmentId: 'dept-A',
          reportingManagerId: 'mgr-1',
        })
        .mockResolvedValueOnce({ id: 'emp-2', departmentId: 'dept-A' });
      prisma.shiftSwapRequest.create.mockResolvedValue({ id: 'swap-1' });

      await expect(
        service.requestSwap(
          'emp-1',
          { counterpartId: 'emp-2', date: '2026-03-01' },
          Role.EMPLOYEE,
        ),
      ).resolves.toBeDefined();
    });
  });

  describe('Business Rule: roster changes after attendance lock require Super Admin override', () => {
    it('fails the assignment when the date is locked and actor is only HR Admin', async () => {
      prisma.attendanceRecord.findUnique.mockResolvedValue({ isLocked: true });

      const result = await service.assignRoster(
        { employeeIds: ['emp-1'], dates: ['2026-01-01'] },
        Role.HR_ADMIN,
      );

      expect(result.failureCount).toBe(1);
      expect(prisma.rosterEntry.upsert).not.toHaveBeenCalled();
    });

    it('succeeds when the actor is Super Admin', async () => {
      prisma.attendanceRecord.findUnique.mockResolvedValue({ isLocked: true });
      prisma.rosterEntry.upsert.mockResolvedValue({ id: 'roster-1' });

      const result = await service.assignRoster(
        { employeeIds: ['emp-1'], dates: ['2026-01-01'] },
        Role.SUPER_ADMIN,
      );

      expect(result.successCount).toBe(1);
    });
  });

  describe('Acceptance Criteria: shift swaps cannot bypass manager approval', () => {
    it('rejects a decision from someone who is not the approver', async () => {
      prisma.shiftSwapRequest.findUnique.mockResolvedValue({
        id: 'swap-1',
        status: 'PENDING',
        approverId: 'mgr-1',
        requesterId: 'emp-1',
        counterpartId: 'emp-2',
      });

      await expect(
        service.decideSwap('swap-1', 'someone-else', true, Role.EMPLOYEE),
      ).rejects.toThrow(ForbiddenException);
    });

    it('allows the assigned approver to decide', async () => {
      prisma.shiftSwapRequest.findUnique.mockResolvedValue({
        id: 'swap-1',
        status: 'PENDING',
        approverId: 'mgr-1',
        requesterId: 'emp-1',
        counterpartId: 'emp-2',
        date: new Date('2026-03-01'),
      });
      prisma.rosterEntry.findUnique.mockResolvedValue(null);
      prisma.rosterEntry.upsert.mockResolvedValue({});
      prisma.shiftSwapRequest.update.mockResolvedValue({});

      await expect(
        service.decideSwap('swap-1', 'mgr-1', true, Role.MANAGER),
      ).resolves.toEqual({ status: 'APPROVED' });
    });
  });
});
