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
    employeeHybridSchedule: {
      upsert: jest.fn().mockResolvedValue({}),
      findUnique: jest.fn(),
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

  describe('assignRoster: workMode is never assumed from a shared policy', () => {
    it('defaults a brand-new roster entry to OFFICE when workMode is not given', async () => {
      prisma.attendanceRecord.findUnique.mockResolvedValue(null);
      prisma.rosterEntry.upsert.mockResolvedValue({ id: 'roster-1' });

      await service.assignRoster({
        employeeIds: ['emp-1'],
        dates: ['2026-08-04'],
        shiftId: undefined,
      });

      expect(prisma.rosterEntry.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({ workMode: 'OFFICE' }),
        }),
      );
    });

    it('does not touch workMode on update when none is given, so reassigning a shift never clobbers an existing WFO/WFH day', async () => {
      prisma.shift.findUnique.mockResolvedValue({ id: 'shift-1' });
      prisma.attendanceRecord.findUnique.mockResolvedValue(null);
      prisma.rosterEntry.upsert.mockResolvedValue({ id: 'roster-1' });

      await service.assignRoster({
        employeeIds: ['emp-1'],
        dates: ['2026-08-04'],
        shiftId: 'shift-1',
      });

      const call = prisma.rosterEntry.upsert.mock.calls[0][0];
      expect(call.update).not.toHaveProperty('workMode');
    });

    it('lets an explicit workMode be set on both create and update', async () => {
      prisma.attendanceRecord.findUnique.mockResolvedValue(null);
      prisma.rosterEntry.upsert.mockResolvedValue({ id: 'roster-1' });

      await service.assignRoster({
        employeeIds: ['emp-1'],
        dates: ['2026-08-04'],
        workMode: 'WORK_FROM_HOME',
      });

      const call = prisma.rosterEntry.upsert.mock.calls[0][0];
      expect(call.create.workMode).toBe('WORK_FROM_HOME');
      expect(call.update.workMode).toBe('WORK_FROM_HOME');
    });
  });

  describe('Hybrid work culture: HR assigns each employee their own WFO weekdays', () => {
    it('stores the schedule and marks every day of the month accordingly', async () => {
      prisma.employee.findUnique.mockResolvedValue({ id: 'emp-1' });
      prisma.rosterEntry.upsert.mockResolvedValue({});

      const result = await service.setEmployeeHybridSchedule({
        employeeId: 'emp-1',
        year: 2026,
        month: 8,
        officeWeekdays: [2, 4], // Tue, Thu
      });

      expect(prisma.employeeHybridSchedule.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: { officeWeekdays: [2, 4] },
        }),
      );
      expect(result.daysUpdated).toBe(31); // August has 31 days

      const calls = prisma.rosterEntry.upsert.mock.calls;
      const aug4 = calls.find(
        (c) => c[0].create.date.toISOString().slice(0, 10) === '2026-08-04',
      ); // Tuesday
      const aug5 = calls.find(
        (c) => c[0].create.date.toISOString().slice(0, 10) === '2026-08-05',
      ); // Wednesday
      expect(aug4[0].update.workMode).toBe('OFFICE');
      expect(aug5[0].update.workMode).toBe('WORK_FROM_HOME');
    });

    it('gives two employees different office weekdays for the same month', async () => {
      prisma.employee.findUnique.mockResolvedValue({ id: 'emp' });
      prisma.rosterEntry.upsert.mockResolvedValue({});

      await service.setEmployeeHybridSchedule({
        employeeId: 'emp-1',
        year: 2026,
        month: 8,
        officeWeekdays: [1, 3], // Mon, Wed
      });
      const emp1Aug4 = prisma.rosterEntry.upsert.mock.calls.find(
        (c) => c[0].create.date.toISOString().slice(0, 10) === '2026-08-04',
      );

      prisma.rosterEntry.upsert.mockClear();
      await service.setEmployeeHybridSchedule({
        employeeId: 'emp-2',
        year: 2026,
        month: 8,
        officeWeekdays: [2, 4], // Tue, Thu
      });
      const emp2Aug4 = prisma.rosterEntry.upsert.mock.calls.find(
        (c) => c[0].create.date.toISOString().slice(0, 10) === '2026-08-04',
      );

      // 2026-08-04 is a Tuesday: WFH under emp-1's Mon/Wed policy,
      // OFFICE under emp-2's Tue/Thu policy — same date, different result.
      expect(emp1Aug4[0].update.workMode).toBe('WORK_FROM_HOME');
      expect(emp2Aug4[0].update.workMode).toBe('OFFICE');
    });

    it('dedupes office weekdays before storing', async () => {
      prisma.employee.findUnique.mockResolvedValue({ id: 'emp-1' });
      prisma.rosterEntry.upsert.mockResolvedValue({});

      const result = await service.setEmployeeHybridSchedule({
        employeeId: 'emp-1',
        year: 2026,
        month: 8,
        officeWeekdays: [2, 4, 2],
      });

      expect(result.officeWeekdays).toEqual([2, 4]);
    });

    it('rejects a schedule for an employee who does not exist', async () => {
      prisma.employee.findUnique.mockResolvedValue(null);

      await expect(
        service.setEmployeeHybridSchedule({
          employeeId: 'ghost',
          year: 2026,
          month: 8,
          officeWeekdays: [2, 4],
        }),
      ).rejects.toThrow('Employee not found');
    });

    it('returns the stored office weekdays for an employee/month', async () => {
      prisma.employeeHybridSchedule.findUnique.mockResolvedValue({
        officeWeekdays: [1, 5],
      });

      await expect(
        service.getEmployeeHybridSchedule('emp-1', 2026, 8),
      ).resolves.toEqual({ officeWeekdays: [1, 5] });
    });

    it('returns an empty schedule when none has been set yet', async () => {
      prisma.employeeHybridSchedule.findUnique.mockResolvedValue(null);

      await expect(
        service.getEmployeeHybridSchedule('emp-1', 2026, 8),
      ).resolves.toEqual({ officeWeekdays: [] });
    });
  });

  describe('Hybrid work culture: bulk WFO upload gives every row its own employee/pattern', () => {
    it('applies a different office-weekday pattern per employee in the same batch', async () => {
      prisma.employee.findUnique
        .mockResolvedValueOnce({ id: 'emp-1', employeeCode: 'EMP-0001' })
        .mockResolvedValueOnce({ id: 'emp-2', employeeCode: 'EMP-0002' });
      prisma.rosterEntry.upsert.mockResolvedValue({});

      const result = await service.bulkSetHybridSchedule(
        [
          { employeeCode: 'EMP-0001', year: 2026, month: 8, officeWeekdays: [1, 3] },
          { employeeCode: 'EMP-0002', year: 2026, month: 8, officeWeekdays: [2, 4] },
        ],
        false,
      );

      expect(result).toMatchObject({ totalRows: 2, successCount: 2, failureCount: 0 });
      expect(prisma.employeeHybridSchedule.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ update: { officeWeekdays: [1, 3] } }),
      );
      expect(prisma.employeeHybridSchedule.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ update: { officeWeekdays: [2, 4] } }),
      );
    });

    it('reports a row-level error for an unknown employee code without failing the rest of the batch', async () => {
      prisma.employee.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'emp-2', employeeCode: 'EMP-0002' });
      prisma.rosterEntry.upsert.mockResolvedValue({});

      const result = await service.bulkSetHybridSchedule(
        [
          { employeeCode: 'GHOST', year: 2026, month: 8, officeWeekdays: [1] },
          { employeeCode: 'EMP-0002', year: 2026, month: 8, officeWeekdays: [2] },
        ],
        false,
      );

      expect(result.successCount).toBe(1);
      expect(result.failureCount).toBe(1);
      expect(result.results[0]).toMatchObject({
        row: 0,
        success: false,
        errors: [expect.stringContaining('GHOST')],
      });
    });

    it('rejects a row with no office weekdays selected, without a database lookup', async () => {
      const result = await service.bulkSetHybridSchedule(
        [{ employeeCode: 'EMP-0001', year: 2026, month: 8, officeWeekdays: [] }],
        false,
      );

      expect(result.failureCount).toBe(1);
      expect(prisma.employee.findUnique).not.toHaveBeenCalled();
    });

    it('validates every row but writes nothing when dryRun is true', async () => {
      prisma.employee.findUnique.mockResolvedValueOnce({
        id: 'emp-1',
        employeeCode: 'EMP-0001',
      });

      const result = await service.bulkSetHybridSchedule(
        [{ employeeCode: 'EMP-0001', year: 2026, month: 8, officeWeekdays: [1] }],
        true,
      );

      expect(result.successCount).toBe(1);
      expect(result.dryRun).toBe(true);
      expect(prisma.employeeHybridSchedule.upsert).not.toHaveBeenCalled();
      expect(prisma.rosterEntry.upsert).not.toHaveBeenCalled();
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
