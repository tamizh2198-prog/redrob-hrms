import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { LeaveApplicationStatus, Role } from '@prisma/client';
import { LeaveService } from './leave.service';
import { PrismaService } from '../../shared/database/prisma.service';
import { DefaultCompanyService } from '../../shared/database/default-company.service';
import { NotificationService } from '../../shared/notifications/notification.service';
import { CalendarService } from '../../shared/calendar/calendar.service';
import { AttendanceService } from '../attendance/attendance.service';

function createMockPrisma() {
  return {
    employee: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
    },
    leaveType: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
    },
    leaveBalance: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      upsert: jest.fn(),
      findMany: jest.fn(),
    },
    leaveApplication: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    leaveApprovalStep: { update: jest.fn(), findMany: jest.fn() },
    $transaction: jest.fn((ops: unknown[]) => Promise.all(ops)),
  };
}

function createMockNotifications() {
  return { send: jest.fn().mockResolvedValue(undefined) };
}

function createMockCalendar() {
  return { isNonWorkingDay: jest.fn().mockResolvedValue(false) };
}

function createMockAttendance() {
  return { syncLeaveStatus: jest.fn().mockResolvedValue(undefined) };
}

function createMockDefaultCompany() {
  return { getOrCreate: jest.fn().mockResolvedValue('company-1') };
}

describe('LeaveService', () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let notifications: ReturnType<typeof createMockNotifications>;
  let calendar: ReturnType<typeof createMockCalendar>;
  let attendance: ReturnType<typeof createMockAttendance>;
  let defaultCompany: ReturnType<typeof createMockDefaultCompany>;
  let service: LeaveService;

  beforeEach(() => {
    prisma = createMockPrisma();
    notifications = createMockNotifications();
    calendar = createMockCalendar();
    attendance = createMockAttendance();
    defaultCompany = createMockDefaultCompany();
    service = new LeaveService(
      prisma as unknown as PrismaService,
      defaultCompany as unknown as DefaultCompanyService,
      notifications as unknown as NotificationService,
      calendar as unknown as CalendarService,
      attendance as unknown as AttendanceService,
    );

    prisma.employee.findUnique.mockResolvedValue({
      id: 'emp-1',
      reportingManagerId: 'mgr-1',
    });
    prisma.leaveType.findUnique.mockResolvedValue({
      id: 'lt-1',
      allowsNegativeBalance: false,
      requiresDocumentAfterDays: null,
    });
    prisma.leaveApplication.findFirst.mockResolvedValue(null);
    prisma.leaveBalance.findUnique.mockResolvedValue({
      id: 'bal-1',
      openingBalance: 10,
      accrued: 0,
      used: 0,
      carriedForward: 0,
    });
  });

  describe('Business Rule: leave balance cannot go negative unless LOP is allowed', () => {
    it('rejects an application exceeding the available balance', async () => {
      prisma.leaveBalance.findUnique.mockResolvedValue({
        id: 'bal-1',
        openingBalance: 1,
        accrued: 0,
        used: 0,
        carriedForward: 0,
      });

      await expect(
        service.applyLeave('emp-1', {
          leaveTypeId: 'lt-1',
          startDate: '2026-03-02',
          endDate: '2026-03-05',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('allows exceeding balance when the leave type allows negative (LOP)', async () => {
      prisma.leaveType.findUnique.mockResolvedValue({
        id: 'lt-1',
        allowsNegativeBalance: true,
      });
      prisma.leaveBalance.findUnique.mockResolvedValue({
        id: 'bal-1',
        openingBalance: 0,
        accrued: 0,
        used: 0,
        carriedForward: 0,
      });
      prisma.leaveApplication.create.mockResolvedValue({
        id: 'app-1',
        approvalSteps: [],
      });

      await expect(
        service.applyLeave('emp-1', {
          leaveTypeId: 'lt-1',
          startDate: '2026-03-02',
          endDate: '2026-03-03',
        }),
      ).resolves.toBeDefined();
    });
  });

  describe('Business Rule: overlapping applications are rejected', () => {
    it('rejects an application overlapping an existing pending/approved one', async () => {
      prisma.leaveApplication.findFirst.mockResolvedValue({
        id: 'existing-app',
      });

      await expect(
        service.applyLeave('emp-1', {
          leaveTypeId: 'lt-1',
          startDate: '2026-03-02',
          endDate: '2026-03-03',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('Phase 6E: half-day leave (duration, not a separate leave type)', () => {
    it('applies daysCount = 0.5 for a HALF_DAY application on a single date', async () => {
      prisma.leaveApplication.create.mockResolvedValue({
        id: 'app-1',
        daysCount: 0.5,
        approvalSteps: [],
      });

      await service.applyLeave('emp-1', {
        leaveTypeId: 'lt-1',
        startDate: '2026-03-02',
        endDate: '2026-03-02',
        duration: 'HALF_DAY',
      });

      const createArgs = prisma.leaveApplication.create.mock.calls[0][0];
      expect(createArgs.data.daysCount).toBe(0.5);
    });

    it('rejects a HALF_DAY application spanning more than one date', async () => {
      await expect(
        service.applyLeave('emp-1', {
          leaveTypeId: 'lt-1',
          startDate: '2026-03-02',
          endDate: '2026-03-03',
          duration: 'HALF_DAY',
        }),
      ).rejects.toThrow('Half-day leave can only be applied for a single date');
      expect(prisma.leaveApplication.create).not.toHaveBeenCalled();
    });

    it('rejects a HALF_DAY application on a non-working day', async () => {
      calendar.isNonWorkingDay.mockResolvedValue(true);

      await expect(
        service.applyLeave('emp-1', {
          leaveTypeId: 'lt-1',
          startDate: '2026-03-02',
          endDate: '2026-03-02',
          duration: 'HALF_DAY',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('validates 0.5 against the available balance (rejects when balance is 0.4)', async () => {
      prisma.leaveBalance.findUnique.mockResolvedValue({
        id: 'bal-1',
        openingBalance: 0.4,
        accrued: 0,
        used: 0,
        carriedForward: 0,
      });

      await expect(
        service.applyLeave('emp-1', {
          leaveTypeId: 'lt-1',
          startDate: '2026-03-02',
          endDate: '2026-03-02',
          duration: 'HALF_DAY',
        }),
      ).rejects.toThrow('Insufficient balance');
    });

    it('overlap check still applies to a half-day application', async () => {
      prisma.leaveApplication.findFirst.mockResolvedValue({ id: 'existing' });

      await expect(
        service.applyLeave('emp-1', {
          leaveTypeId: 'lt-1',
          startDate: '2026-03-02',
          endDate: '2026-03-02',
          duration: 'HALF_DAY',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('final approval of a half-day application debits the balance by exactly 0.5', async () => {
      prisma.leaveApplication.findUnique.mockResolvedValue({
        id: 'app-1',
        employeeId: 'emp-1',
        leaveTypeId: 'lt-1',
        startDate: new Date('2026-03-02'),
        endDate: new Date('2026-03-02'),
        daysCount: 0.5,
        status: LeaveApplicationStatus.PENDING,
        approvalSteps: [
          {
            id: 'step-1',
            sequence: 1,
            approverId: 'mgr-1',
            decision: 'PENDING',
          },
        ],
      });
      prisma.leaveBalance.findUnique.mockResolvedValue({
        id: 'bal-1',
        openingBalance: 5,
        accrued: 0,
        used: 1,
        carriedForward: 0,
      });

      await service.decideLeave(
        'app-1',
        'mgr-1',
        { approve: true },
        Role.MANAGER,
      );

      expect(prisma.leaveBalance.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { used: 1.5 } }),
      );
      expect(attendance.syncLeaveStatus).toHaveBeenCalledWith(
        'emp-1',
        [new Date('2026-03-02')],
        true,
      );
    });
  });

  describe('Business Rule: multi-level approval beyond the consecutive-day threshold', () => {
    it('creates a single approval step for a short application', async () => {
      prisma.leaveApplication.create.mockResolvedValue({
        id: 'app-1',
        approvalSteps: [],
      });

      await service.applyLeave('emp-1', {
        leaveTypeId: 'lt-1',
        startDate: '2026-03-02',
        endDate: '2026-03-03', // 2 days, under the threshold
      });

      const createArgs = prisma.leaveApplication.create.mock.calls[0][0];
      expect(createArgs.data.approvalSteps.create).toHaveLength(1);
    });

    it('creates a second (skip-level) approval step beyond the threshold', async () => {
      prisma.employee.findUnique
        .mockResolvedValueOnce({ id: 'emp-1', reportingManagerId: 'mgr-1' }) // the applicant
        .mockResolvedValueOnce({ id: 'mgr-1', reportingManagerId: 'skip-1' }); // their manager
      prisma.leaveBalance.findUnique.mockResolvedValue({
        id: 'bal-1',
        openingBalance: 20,
        accrued: 0,
        used: 0,
        carriedForward: 0,
      });
      prisma.leaveApplication.create.mockResolvedValue({
        id: 'app-1',
        approvalSteps: [],
      });

      await service.applyLeave('emp-1', {
        leaveTypeId: 'lt-1',
        startDate: '2026-03-02',
        endDate: '2026-03-09', // 8 days, over the 5-day threshold
      });

      const createArgs = prisma.leaveApplication.create.mock.calls[0][0];
      expect(createArgs.data.approvalSteps.create).toHaveLength(2);
      expect(createArgs.data.approvalSteps.create[1].approverId).toBe('skip-1');
    });
  });

  describe('This task: applicant with no reportingManagerId (e.g. Super Admin)', () => {
    it('falls back to an existing HR Admin/Super Admin as approver, excluding the applicant', async () => {
      prisma.employee.findUnique.mockResolvedValue({
        id: 'super-admin-1',
        reportingManagerId: null,
      });
      prisma.employee.findFirst.mockResolvedValue({ id: 'hr-admin-1' });
      prisma.leaveApplication.create.mockResolvedValue({
        id: 'app-1',
        approvalSteps: [],
      });

      await service.applyLeave('super-admin-1', {
        leaveTypeId: 'lt-1',
        startDate: '2026-03-02',
        endDate: '2026-03-03',
      });

      expect(prisma.employee.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: { not: 'super-admin-1' } }),
        }),
      );
      const createArgs = prisma.leaveApplication.create.mock.calls[0][0];
      expect(createArgs.data.currentApproverId).toBe('hr-admin-1');
      expect(createArgs.data.approvalSteps.create[0].approverId).toBe(
        'hr-admin-1',
      );
    });

    it('rejects explicitly when no manager and no other HR Admin/Super Admin exist', async () => {
      prisma.employee.findUnique.mockResolvedValue({
        id: 'super-admin-1',
        reportingManagerId: null,
      });
      prisma.employee.findFirst.mockResolvedValue(null);

      await expect(
        service.applyLeave('super-admin-1', {
          leaveTypeId: 'lt-1',
          startDate: '2026-03-02',
          endDate: '2026-03-03',
        }),
      ).rejects.toThrow('No approver is configured for this employee');
      expect(prisma.leaveApplication.create).not.toHaveBeenCalled();
    });
  });

  describe('Integration point: Holiday/week-off exclusion from the day count', () => {
    it('excludes non-working days from daysCount', async () => {
      calendar.isNonWorkingDay.mockImplementation((_id: string, date: Date) =>
        Promise.resolve(date.getDay() === 0 || date.getDay() === 6),
      );
      prisma.leaveApplication.create.mockResolvedValue({
        id: 'app-1',
        approvalSteps: [],
      });

      // 2026-03-02 is a Monday; range Mon-Sun (7 days) should exclude the weekend.
      await service.applyLeave('emp-1', {
        leaveTypeId: 'lt-1',
        startDate: '2026-03-02',
        endDate: '2026-03-08',
      });

      const createArgs = prisma.leaveApplication.create.mock.calls[0][0];
      expect(createArgs.data.daysCount).toBe(5);
    });
  });

  describe('Multi-level approval routing and final approval', () => {
    it('advances to the next approver without finalizing on an intermediate approval', async () => {
      prisma.leaveApplication.findUnique.mockResolvedValue({
        id: 'app-1',
        employeeId: 'emp-1',
        leaveTypeId: 'lt-1',
        status: LeaveApplicationStatus.PENDING,
        startDate: new Date('2026-03-02'),
        endDate: new Date('2026-03-09'),
        daysCount: 8,
        approvalSteps: [
          {
            id: 'step-1',
            sequence: 1,
            approverId: 'mgr-1',
            decision: 'PENDING',
          },
          {
            id: 'step-2',
            sequence: 2,
            approverId: 'skip-1',
            decision: 'PENDING',
          },
        ],
      });

      const result = await service.decideLeave(
        'app-1',
        'mgr-1',
        { approve: true },
        Role.MANAGER,
      );

      expect(result).toEqual({ status: 'PENDING', nextApproverId: 'skip-1' });
      expect(attendance.syncLeaveStatus).not.toHaveBeenCalled();
    });

    it('debits balance and syncs Attendance on final approval', async () => {
      prisma.leaveApplication.findUnique.mockResolvedValue({
        id: 'app-1',
        employeeId: 'emp-1',
        leaveTypeId: 'lt-1',
        status: LeaveApplicationStatus.PENDING,
        startDate: new Date('2026-03-02'),
        endDate: new Date('2026-03-03'),
        daysCount: 2,
        approvalSteps: [
          {
            id: 'step-1',
            sequence: 1,
            approverId: 'mgr-1',
            decision: 'PENDING',
          },
        ],
      });

      const result = await service.decideLeave(
        'app-1',
        'mgr-1',
        { approve: true },
        Role.MANAGER,
      );

      expect(result).toEqual({ status: 'APPROVED' });
      expect(prisma.leaveBalance.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { used: 2 } }),
      );
      expect(attendance.syncLeaveStatus).toHaveBeenCalledWith(
        'emp-1',
        expect.any(Array),
        true,
      );
    });

    it('rejects a decision from someone who is not the current approver', async () => {
      prisma.leaveApplication.findUnique.mockResolvedValue({
        id: 'app-1',
        status: LeaveApplicationStatus.PENDING,
        approvalSteps: [
          {
            id: 'step-1',
            sequence: 1,
            approverId: 'mgr-1',
            decision: 'PENDING',
          },
        ],
      });

      await expect(
        service.decideLeave(
          'app-1',
          'someone-else',
          { approve: true },
          Role.EMPLOYEE,
        ),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('Acceptance Criteria: cancelling an approved leave restores balance and updates Attendance', () => {
    it('credits the balance back and reverts attendance', async () => {
      prisma.leaveApplication.findUnique.mockResolvedValue({
        id: 'app-1',
        employeeId: 'emp-1',
        leaveTypeId: 'lt-1',
        status: LeaveApplicationStatus.APPROVED,
        startDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        endDate: new Date(Date.now() + 32 * 24 * 60 * 60 * 1000),
        daysCount: 3,
      });
      prisma.leaveBalance.findUnique.mockResolvedValue({
        id: 'bal-1',
        openingBalance: 10,
        accrued: 0,
        used: 3,
        carriedForward: 0,
      });
      prisma.leaveApprovalStep.findMany.mockResolvedValue([
        { approverId: 'mgr-1' },
      ]);

      const result = await service.cancelLeave('app-1', 'emp-1', Role.EMPLOYEE);

      expect(result).toEqual({ status: 'CANCELLED' });
      expect(prisma.leaveBalance.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { used: 0 } }),
      );
      expect(attendance.syncLeaveStatus).toHaveBeenCalledWith(
        'emp-1',
        expect.any(Array),
        false,
      );
    });

    it('rejects cancelling a leave that has already started', async () => {
      prisma.leaveApplication.findUnique.mockResolvedValue({
        id: 'app-1',
        employeeId: 'emp-1',
        status: LeaveApplicationStatus.APPROVED,
        startDate: new Date(Date.now() - 24 * 60 * 60 * 1000),
        endDate: new Date(Date.now() + 24 * 60 * 60 * 1000),
        daysCount: 2,
      });

      await expect(
        service.cancelLeave('app-1', 'emp-1', Role.EMPLOYEE),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('Acceptance Criteria: accrual pro-rates for a mid-month joiner', () => {
    it('prorates the accrual amount for an employee joining mid-month', async () => {
      prisma.leaveType.findMany.mockResolvedValue([
        { id: 'lt-1', accrualFrequency: 'MONTHLY', accrualRate: 30 },
      ]);
      prisma.employee.findMany.mockResolvedValue([
        { id: 'emp-1', dateOfJoining: new Date(Date.UTC(2026, 2, 16)) }, // March 16 of 31-day month
      ]);
      prisma.leaveBalance.findUnique.mockResolvedValue(null);
      prisma.leaveBalance.create.mockResolvedValue({
        id: 'bal-1',
        openingBalance: 0,
        accrued: 0,
        used: 0,
        carriedForward: 0,
      });

      await service.runMonthlyAccrual(2026, 3);

      // 16 days worked out of 31 → 30 * (16/31)
      const expectedAccrual = 30 * (16 / 31);
      expect(prisma.leaveBalance.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { accrued: expectedAccrual } }),
      );
    });

    it('accrues the full rate for an existing employee', async () => {
      prisma.leaveType.findMany.mockResolvedValue([
        { id: 'lt-1', accrualFrequency: 'MONTHLY', accrualRate: 1.5 },
      ]);
      prisma.employee.findMany.mockResolvedValue([
        { id: 'emp-1', dateOfJoining: new Date(Date.UTC(2020, 0, 1)) },
      ]);
      prisma.leaveBalance.findUnique.mockResolvedValue({
        id: 'bal-1',
        openingBalance: 0,
        accrued: 5,
        used: 0,
        carriedForward: 0,
      });

      await service.runMonthlyAccrual(2026, 3);

      expect(prisma.leaveBalance.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { accrued: 6.5 } }),
      );
    });
  });

  describe('Quarterly accrual (Sick Leave / Care Leave)', () => {
    it('accrues quarterly-frequency leave types on a quarter-start month', async () => {
      prisma.leaveType.findMany.mockResolvedValue([
        { id: 'lt-sl', accrualFrequency: 'QUARTERLY', accrualRate: 1 },
      ]);
      prisma.employee.findMany.mockResolvedValue([
        { id: 'emp-1', dateOfJoining: new Date(Date.UTC(2020, 0, 1)) },
      ]);
      prisma.leaveBalance.findUnique.mockResolvedValue({
        id: 'bal-1',
        openingBalance: 0,
        accrued: 0,
        used: 0,
        carriedForward: 0,
      });

      await service.runMonthlyAccrual(2026, 4); // April = quarter start

      expect(prisma.leaveBalance.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { accrued: 1 } }),
      );
    });

    it('does not accrue quarterly-frequency leave types on a non-quarter-start month', async () => {
      prisma.leaveType.findMany.mockResolvedValue([]);
      prisma.employee.findMany.mockResolvedValue([
        { id: 'emp-1', dateOfJoining: new Date(Date.UTC(2020, 0, 1)) },
      ]);

      const result = await service.runMonthlyAccrual(2026, 5); // May, not a quarter start

      expect(prisma.leaveType.findMany).toHaveBeenCalledWith({
        where: { accrualFrequency: { in: ['MONTHLY'] }, isCompOff: false },
      });
      expect(result.accrualsRun).toBe(0);
    });

    it('prorates quarterly accrual for an employee joining mid-quarter', async () => {
      prisma.leaveType.findMany.mockResolvedValue([
        { id: 'lt-cl', accrualFrequency: 'QUARTERLY', accrualRate: 1 },
      ]);
      // Joins May 16 — 46 days worked out of the Apr 1..Jun 30 quarter (91 days)
      prisma.employee.findMany.mockResolvedValue([
        { id: 'emp-1', dateOfJoining: new Date(Date.UTC(2026, 4, 16)) },
      ]);
      prisma.leaveBalance.findUnique.mockResolvedValue(null);
      prisma.leaveBalance.create.mockResolvedValue({
        id: 'bal-1',
        openingBalance: 0,
        accrued: 0,
        used: 0,
        carriedForward: 0,
      });

      await service.runMonthlyAccrual(2026, 4);

      const expectedAccrual = 1 * (46 / 91);
      expect(prisma.leaveBalance.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { accrued: expectedAccrual } }),
      );
    });
  });

  describe('Acceptance Criteria: carry-forward cap and auto-encashment/lapse at year-end close', () => {
    it('caps carry-forward and triggers encashment for the excess when encashable', async () => {
      prisma.leaveBalance.findMany.mockResolvedValue([
        {
          id: 'bal-1',
          employeeId: 'emp-1',
          leaveTypeId: 'lt-1',
          year: 2026,
          openingBalance: 0,
          accrued: 15,
          used: 0,
          leaveType: { id: 'lt-1', maxCarryForward: 10, isEncashable: true },
        },
      ]);

      await service.runYearEndClose(2026);

      expect(prisma.leaveBalance.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: { openingBalance: 10, carriedForward: 10 },
        }),
      );
      expect(notifications.send).toHaveBeenCalledWith(
        expect.objectContaining({ template: 'leave.year-end-encashment' }),
      );
    });

    it('lapses the excess silently when the leave type is not encashable', async () => {
      prisma.leaveBalance.findMany.mockResolvedValue([
        {
          id: 'bal-1',
          employeeId: 'emp-1',
          leaveTypeId: 'lt-1',
          year: 2026,
          openingBalance: 0,
          accrued: 15,
          used: 0,
          leaveType: { id: 'lt-1', maxCarryForward: 10, isEncashable: false },
        },
      ]);

      await service.runYearEndClose(2026);

      expect(notifications.send).not.toHaveBeenCalled();
    });
  });

  describe('Phase 6A: company-wide pending leave listing', () => {
    it('lists PENDING applications company-wide, unscoped by approver', async () => {
      prisma.leaveApplication.findMany.mockResolvedValue([
        { id: 'app-1', status: 'PENDING' },
        { id: 'app-2', status: 'PENDING' },
      ]);

      const result = await service.listAllPendingApplications();

      expect(prisma.leaveApplication.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { status: LeaveApplicationStatus.PENDING },
        }),
      );
      expect(result).toHaveLength(2);
    });

    it('SECURITY: never returns passwordHash on the included employee', async () => {
      prisma.leaveApplication.findMany.mockResolvedValue([
        {
          id: 'app-1',
          status: 'PENDING',
          employee: {
            id: 'emp-1',
            firstName: 'Jane',
            passwordHash: 'super-secret-hash',
          },
        },
      ]);

      const result = await service.listAllPendingApplications();

      expect(result[0].employee).not.toHaveProperty('passwordHash');
      expect(result[0].employee.firstName).toBe('Jane');
    });
  });

  describe('SECURITY: listPendingApprovals and getTeamCalendar never leak passwordHash', () => {
    it('listPendingApprovals strips passwordHash from the included employee', async () => {
      prisma.leaveApplication.findMany.mockResolvedValue([
        {
          id: 'app-1',
          status: 'PENDING',
          employee: {
            id: 'emp-1',
            firstName: 'Jane',
            passwordHash: 'super-secret-hash',
          },
        },
      ]);

      const result = await service.listPendingApprovals('mgr-1');

      expect(result[0].employee).not.toHaveProperty('passwordHash');
    });

    it('getTeamCalendar strips passwordHash from the included employee', async () => {
      prisma.employee.findMany.mockResolvedValue([{ id: 'emp-1' }]);
      prisma.leaveApplication.findMany.mockResolvedValue([
        {
          id: 'app-1',
          status: 'APPROVED',
          employee: {
            id: 'emp-1',
            firstName: 'Jane',
            passwordHash: 'super-secret-hash',
          },
        },
      ]);

      const result = await service.getTeamCalendar(
        'mgr-1',
        new Date('2026-01-01'),
        new Date('2026-01-31'),
      );

      expect(result[0].employee).not.toHaveProperty('passwordHash');
    });
  });

  describe('Phase 6B: employee leave-history authorization (Employee Profile → Leave)', () => {
    it('SUPER_ADMIN can view any employee’s leave history', async () => {
      prisma.leaveApplication.findMany.mockResolvedValue([{ id: 'app-1' }]);

      const result = await service.listApplicationsForEmployee(
        'emp-2',
        'admin-1',
        Role.SUPER_ADMIN,
      );

      expect(result).toEqual([{ id: 'app-1' }]);
    });

    it('an employee can view their own leave history', async () => {
      prisma.leaveApplication.findMany.mockResolvedValue([]);

      await expect(
        service.listApplicationsForEmployee('emp-1', 'emp-1', Role.EMPLOYEE),
      ).resolves.toEqual([]);
    });

    it('a direct manager can view their report’s leave history', async () => {
      prisma.employee.findUnique.mockResolvedValue({
        reportingManagerId: 'mgr-1',
      });
      prisma.leaveApplication.findMany.mockResolvedValue([]);

      await expect(
        service.listApplicationsForEmployee('emp-2', 'mgr-1', Role.MANAGER),
      ).resolves.toEqual([]);
    });

    it('an unrelated EMPLOYEE cannot view another employee’s leave history', async () => {
      prisma.employee.findUnique.mockResolvedValue({
        reportingManagerId: 'someone-else',
      });

      await expect(
        service.listApplicationsForEmployee('emp-2', 'emp-3', Role.EMPLOYEE),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.leaveApplication.findMany).not.toHaveBeenCalled();
    });
  });
});
