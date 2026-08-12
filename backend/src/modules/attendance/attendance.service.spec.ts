import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { AttendanceStatus, Role } from '@prisma/client';
import { AttendanceService } from './attendance.service';
import { PrismaService } from '../../shared/database/prisma.service';
import { NotificationService } from '../../shared/notifications/notification.service';
import { CalendarService } from '../../shared/calendar/calendar.service';

function createMockPrisma() {
  return {
    attendanceRecord: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      findMany: jest.fn(),
    },
    regularizationRequest: {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
    },
    employee: { findUnique: jest.fn(), findMany: jest.fn() },
    $transaction: jest.fn((ops: unknown[]) => Promise.all(ops)),
  };
}

function createMockNotifications() {
  return { send: jest.fn().mockResolvedValue(undefined) };
}

function createMockCalendar() {
  return {
    getActiveShift: jest.fn().mockResolvedValue(null),
    isHoliday: jest.fn().mockResolvedValue(false),
    isWeekOff: jest.fn().mockResolvedValue(false),
    isWFH: jest.fn().mockResolvedValue(false),
    isNonWorkingDay: jest.fn().mockResolvedValue(false),
  };
}

describe('AttendanceService', () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let notifications: ReturnType<typeof createMockNotifications>;
  let calendar: ReturnType<typeof createMockCalendar>;
  let service: AttendanceService;

  beforeEach(() => {
    prisma = createMockPrisma();
    notifications = createMockNotifications();
    calendar = createMockCalendar();
    service = new AttendanceService(
      prisma as unknown as PrismaService,
      notifications as unknown as NotificationService,
      calendar as unknown as CalendarService,
    );
  });

  describe('Business Rule: cannot check in twice without checking out', () => {
    it('rejects a second check-in while still checked in', async () => {
      prisma.attendanceRecord.findUnique.mockResolvedValue({
        checkInTime: new Date(),
        checkOutTime: null,
      });

      await expect(service.punch('emp-1', 'IN')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects checking out before checking in', async () => {
      prisma.attendanceRecord.findUnique.mockResolvedValue(null);

      await expect(service.punch('emp-1', 'OUT')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('Phase 6D: minimum 5-minute interval between Punch In and Punch Out', () => {
    it('rejects a punch-out 3 minutes after punch-in', async () => {
      prisma.attendanceRecord.findUnique.mockResolvedValue({
        checkInTime: new Date(Date.now() - 3 * 60 * 1000),
        checkOutTime: null,
      });

      await expect(service.punch('emp-1', 'OUT')).rejects.toThrow(
        'Punch out must be at least 5 minutes after punch in',
      );
      expect(prisma.attendanceRecord.update).not.toHaveBeenCalled();
    });

    it('allows a punch-out exactly 5 minutes after punch-in', async () => {
      prisma.attendanceRecord.findUnique.mockResolvedValue({
        checkInTime: new Date(Date.now() - 5 * 60 * 1000),
        checkOutTime: null,
      });
      prisma.attendanceRecord.update.mockResolvedValue({
        status: AttendanceStatus.PRESENT,
      });

      await expect(service.punch('emp-1', 'OUT')).resolves.toBeDefined();
      expect(prisma.attendanceRecord.update).toHaveBeenCalled();
    });

    it('allows a punch-out well after the 5-minute minimum', async () => {
      prisma.attendanceRecord.findUnique.mockResolvedValue({
        checkInTime: new Date(Date.now() - 20 * 60 * 1000),
        checkOutTime: null,
      });
      prisma.attendanceRecord.update.mockResolvedValue({
        status: AttendanceStatus.PRESENT,
      });

      await expect(service.punch('emp-1', 'OUT')).resolves.toBeDefined();
    });
  });

  describe('Acceptance Criteria: status is correctly computed against shift and grace-period rules', () => {
    // Routed through importBiometric rather than punch() so check-in/out times
    // are explicit inputs instead of relying on the wall clock at test time.
    async function importOneRow(checkInTime: string, checkOutTime: string) {
      prisma.employee.findUnique.mockResolvedValue({
        id: 'emp-1',
        employeeCode: 'EMP-1',
      });
      calendar.getActiveShift.mockResolvedValue({
        startTime: '09:00',
        endTime: '18:00',
        graceMinutes: 10,
        halfDayHours: 4.5,
      });
      let saved: { status: AttendanceStatus } | undefined;
      prisma.attendanceRecord.upsert.mockImplementation(
        (args: { create: { status: AttendanceStatus } }) => {
          saved = args.create;
          return Promise.resolve(args.create);
        },
      );

      await service.importBiometric({
        rows: [
          {
            employeeCode: 'EMP-1',
            date: '2026-03-02',
            checkInTime,
            checkOutTime,
          },
        ],
      });
      return saved;
    }

    it('marks HALF_DAY when worked hours fall below the shift half-day threshold', async () => {
      const saved = await importOneRow(
        '2026-03-02T09:00:00',
        '2026-03-02T12:00:00',
      );
      expect(saved?.status).toBe(AttendanceStatus.HALF_DAY);
    });

    it('marks LATE when check-in is after the grace period', async () => {
      const saved = await importOneRow(
        '2026-03-02T09:20:00',
        '2026-03-02T18:00:00',
      );
      expect(saved?.status).toBe(AttendanceStatus.LATE);
    });

    it('marks PRESENT for a normal on-time full day', async () => {
      const saved = await importOneRow(
        '2026-03-02T09:00:00',
        '2026-03-02T18:00:00',
      );
      expect(saved?.status).toBe(AttendanceStatus.PRESENT);
    });
  });

  describe('Business Rule: regularization submission window', () => {
    it('rejects a request for a date outside the configurable window', async () => {
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 30);

      await expect(
        service.regularize('emp-1', {
          date: oldDate.toISOString(),
          requestedStatus: AttendanceStatus.PRESENT,
          reason: 'Forgot to punch',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('Acceptance Criteria: regularization can only be decided by the assigned approver or an escalation target', () => {
    it('rejects a decision from an unrelated employee', async () => {
      prisma.regularizationRequest.findUnique.mockResolvedValue({
        id: 'req-1',
        status: 'PENDING',
        approverId: 'mgr-1',
        employeeId: 'emp-1',
        date: new Date(),
      });

      await expect(
        service.decideRegularization(
          'req-1',
          'someone-else',
          { approve: true },
          Role.EMPLOYEE,
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('allows the assigned manager to approve', async () => {
      prisma.regularizationRequest.findUnique.mockResolvedValue({
        id: 'req-1',
        status: 'PENDING',
        approverId: 'mgr-1',
        employeeId: 'emp-1',
        date: new Date(),
        requestedStatus: AttendanceStatus.PRESENT,
      });
      prisma.attendanceRecord.findUnique.mockResolvedValue(null); // not locked

      await expect(
        service.decideRegularization(
          'req-1',
          'mgr-1',
          { approve: true },
          Role.MANAGER,
        ),
      ).resolves.toEqual({ status: 'APPROVED' });
    });

    it('allows HR Admin to act as an escalation target', async () => {
      prisma.regularizationRequest.findUnique.mockResolvedValue({
        id: 'req-1',
        status: 'PENDING',
        approverId: 'mgr-1',
        employeeId: 'emp-1',
        date: new Date(),
        requestedStatus: AttendanceStatus.PRESENT,
      });
      prisma.attendanceRecord.findUnique.mockResolvedValue(null);

      await expect(
        service.decideRegularization(
          'req-1',
          'hr-1',
          { approve: true },
          Role.HR_ADMIN,
        ),
      ).resolves.toEqual({ status: 'APPROVED' });
    });
  });

  describe('Business Rule: locked attendance months cannot be edited by Manager/Employee', () => {
    it('rejects a Manager decision on a locked date', async () => {
      prisma.regularizationRequest.findUnique.mockResolvedValue({
        id: 'req-1',
        status: 'PENDING',
        approverId: 'mgr-1',
        employeeId: 'emp-1',
        date: new Date(),
      });
      prisma.attendanceRecord.findUnique.mockResolvedValue({ isLocked: true });

      await expect(
        service.decideRegularization(
          'req-1',
          'mgr-1',
          { approve: true },
          Role.MANAGER,
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('allows Super Admin to edit a locked date', async () => {
      prisma.regularizationRequest.findUnique.mockResolvedValue({
        id: 'req-1',
        status: 'PENDING',
        approverId: 'mgr-1',
        employeeId: 'emp-1',
        date: new Date(),
        requestedStatus: AttendanceStatus.PRESENT,
      });
      prisma.attendanceRecord.findUnique.mockResolvedValue({ isLocked: true });

      await expect(
        service.decideRegularization(
          'req-1',
          'super-1',
          { approve: true },
          Role.SUPER_ADMIN,
        ),
      ).resolves.toEqual({ status: 'APPROVED' });
    });
  });

  describe('Acceptance Criteria: biometric import flags unmatched device codes', () => {
    it('flags rows whose employee code does not resolve', async () => {
      prisma.employee.findUnique.mockResolvedValue(null);

      const result = await service.importBiometric({
        rows: [{ employeeCode: 'UNKNOWN-1', date: '2026-03-01' }],
      });

      expect(result.unmatchedCount).toBe(1);
      expect(result.unmatched[0].employeeCode).toBe('UNKNOWN-1');
    });

    it('imports a matched row and computes status', async () => {
      prisma.employee.findUnique.mockResolvedValue({
        id: 'emp-1',
        employeeCode: 'EMP-1',
      });
      prisma.attendanceRecord.upsert.mockResolvedValue({});

      const result = await service.importBiometric({
        rows: [
          {
            employeeCode: 'EMP-1',
            date: '2026-03-01',
            checkInTime: '2026-03-01T09:00:00',
            checkOutTime: '2026-03-01T18:00:00',
          },
        ],
      });

      expect(result.matchedCount).toBe(1);
      expect(result.unmatchedCount).toBe(0);
    });
  });

  describe('This task: getCalendar returns check-in/out, duration, and regularization info', () => {
    it('includes checkInTime/checkOutTime/workHours for a day with a record', async () => {
      const checkInTime = new Date('2026-01-05T09:00:00Z');
      const checkOutTime = new Date('2026-01-05T18:00:00Z');
      prisma.attendanceRecord.findMany.mockResolvedValue([
        {
          date: new Date('2026-01-05T00:00:00Z'),
          status: AttendanceStatus.PRESENT,
          checkInTime,
          checkOutTime,
          workHours: 9,
        },
      ]);

      const days = await service.getCalendar('emp-1', 2026, 1);
      const jan5 = days.find((d) => d.date === '2026-01-05');

      expect(jan5?.checkInTime).toBe(checkInTime);
      expect(jan5?.checkOutTime).toBe(checkOutTime);
      expect(jan5?.workHours).toBe(9);
    });

    it('attaches the most recent regularization for a date, when one exists', async () => {
      prisma.attendanceRecord.findMany.mockResolvedValue([]);
      prisma.regularizationRequest.findMany.mockResolvedValue([
        {
          date: new Date('2026-01-05T00:00:00Z'),
          status: 'PENDING',
          requestedStatus: AttendanceStatus.WFH,
          reason: 'Worked from client site',
          createdAt: new Date('2026-01-06T00:00:00Z'),
        },
      ]);

      const days = await service.getCalendar('emp-1', 2026, 1);
      const jan5 = days.find((d) => d.date === '2026-01-05');

      expect(jan5?.regularization).toEqual({
        status: 'PENDING',
        requestedStatus: AttendanceStatus.WFH,
        reason: 'Worked from client site',
      });
    });

    it('reports null regularization for a date with no request', async () => {
      prisma.attendanceRecord.findMany.mockResolvedValue([]);

      const days = await service.getCalendar('emp-1', 2026, 1);
      const jan10 = days.find((d) => d.date === '2026-01-10');

      expect(jan10?.regularization).toBeNull();
    });
  });

  describe('This task: a day with no record is only ABSENT if it has already happened', () => {
    it('reports ABSENT for a past date with no record (unchanged behavior)', async () => {
      prisma.attendanceRecord.findMany.mockResolvedValue([]);

      const days = await service.getCalendar('emp-1', 2026, 1);
      const jan10 = days.find((d) => d.date === '2026-01-10');

      expect(jan10?.status).toBe(AttendanceStatus.ABSENT);
    });

    it('reports UPCOMING (not ABSENT) for a future date with no record', async () => {
      prisma.attendanceRecord.findMany.mockResolvedValue([]);

      const days = await service.getCalendar('emp-1', 2099, 1);
      const jan15 = days.find((d) => d.date === '2099-01-15');

      expect(jan15?.status).toBe('UPCOMING');
    });

    it('still reports HOLIDAY/WEEK_OFF/WFH for a future date, not UPCOMING', async () => {
      prisma.attendanceRecord.findMany.mockResolvedValue([]);
      calendar.isWeekOff.mockResolvedValue(true);

      const days = await service.getCalendar('emp-1', 2099, 1);
      const jan15 = days.find((d) => d.date === '2099-01-15');

      expect(jan15?.status).toBe(AttendanceStatus.WEEK_OFF);
    });
  });

  describe('SECURITY: listRegularizations never leaks the included employee passwordHash', () => {
    it('strips passwordHash from every returned request', async () => {
      prisma.regularizationRequest.findMany.mockResolvedValue([
        {
          id: 'reg-1',
          employee: {
            id: 'emp-1',
            firstName: 'Jane',
            passwordHash: 'super-secret-hash',
          },
        },
      ]);

      const result = await service.listRegularizations({ status: 'PENDING' });

      expect(result[0].employee).not.toHaveProperty('passwordHash');
      expect(result[0].employee.firstName).toBe('Jane');
    });
  });

  describe('Integration point: Holiday exclusion — never marks a holiday as Absent', () => {
    it('reports HOLIDAY status for a day with no attendance record on a holiday', async () => {
      prisma.attendanceRecord.findMany.mockResolvedValue([]);
      calendar.isHoliday.mockResolvedValue(true);

      const days = await service.getCalendar('emp-1', 2026, 1, {
        userId: 'emp-1',
        role: Role.EMPLOYEE,
      });
      const jan26 = days.find((d) => d.date === '2026-01-26');

      expect(jan26?.status).toBe(AttendanceStatus.HOLIDAY);
    });
  });

  describe('Integration point: hybrid roster drives WFH status', () => {
    it('reports WFH for a day with no attendance record on a WFH roster day', async () => {
      prisma.attendanceRecord.findMany.mockResolvedValue([]);
      calendar.isWFH.mockResolvedValue(true);

      const days = await service.getCalendar('emp-1', 2026, 1, {
        userId: 'emp-1',
        role: Role.EMPLOYEE,
      });
      const jan5 = days.find((d) => d.date === '2026-01-05');

      expect(jan5?.status).toBe(AttendanceStatus.WFH);
    });
  });

  describe('Integration point: Leave approval reflects in the attendance record', () => {
    it('marks ON_LEAVE for working days and skips holidays/week-offs', async () => {
      calendar.isNonWorkingDay.mockImplementation((_id: string, date: Date) =>
        Promise.resolve(date.getDate() === 2),
      );
      prisma.attendanceRecord.upsert.mockResolvedValue({});

      await service.syncLeaveStatus(
        'emp-1',
        [
          new Date('2026-03-01'),
          new Date('2026-03-02'),
          new Date('2026-03-03'),
        ],
        true,
      );

      expect(prisma.attendanceRecord.upsert).toHaveBeenCalledTimes(2);
    });

    it('reverts ON_LEAVE back to ABSENT on cancellation', async () => {
      prisma.attendanceRecord.findUnique.mockResolvedValue({
        status: AttendanceStatus.ON_LEAVE,
      });
      prisma.attendanceRecord.update.mockResolvedValue({});

      await service.syncLeaveStatus('emp-1', [new Date('2026-03-01')], false);

      expect(prisma.attendanceRecord.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: AttendanceStatus.ABSENT }),
        }),
      );
    });
  });
});
