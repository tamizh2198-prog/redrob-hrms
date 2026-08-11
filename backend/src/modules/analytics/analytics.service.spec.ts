import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';
import { PrismaService } from '../../shared/database/prisma.service';
import { LeaveService } from '../leave/leave.service';
import { BuildReportDto } from './dto/build-report.dto';

function createMockPrisma() {
  return {
    employee: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      groupBy: jest.fn(),
    },
    ticket: { count: jest.fn() },
    attendanceRecord: { groupBy: jest.fn(), findMany: jest.fn() },
    goal: { findMany: jest.fn() },
    resignation: { count: jest.fn() },
    candidate: { groupBy: jest.fn(), findMany: jest.fn() },
    jobRequisition: { count: jest.fn() },
    leaveBalance: { findMany: jest.fn() },
    leaveApplication: { findMany: jest.fn() },
    asset: { findMany: jest.fn() },
    savedReport: {
      create: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
  };
}

function createMockLeaveService() {
  return {
    getBalances: jest.fn().mockResolvedValue([]),
    listMyApplications: jest.fn().mockResolvedValue([]),
    listPendingApprovals: jest.fn().mockResolvedValue([]),
  };
}

describe('AnalyticsService', () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let leaveService: ReturnType<typeof createMockLeaveService>;
  let service: AnalyticsService;

  beforeEach(() => {
    prisma = createMockPrisma();
    leaveService = createMockLeaveService();
    service = new AnalyticsService(
      prisma as unknown as PrismaService,
      leaveService as unknown as LeaveService,
    );
  });

  describe("Architecture Decision: dashboard type is derived from the caller's own role", () => {
    it('rejects a role with no defined dashboard', async () => {
      await expect(service.getDashboard('emp-1', undefined)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('routes EMPLOYEE to the self-scoped dashboard', async () => {
      prisma.ticket.count.mockResolvedValue(2);

      const result = await service.getDashboard('emp-1', 'EMPLOYEE');
      expect(result.role).toBe('EMPLOYEE');
      expect(leaveService.getBalances).toHaveBeenCalledWith(
        'emp-1',
        expect.any(Number),
      );
    });

    it('routes SUPER_ADMIN to the same org-wide rollup as HR_ADMIN, tagged as SUPER_ADMIN', async () => {
      prisma.employee.findUnique.mockResolvedValue({
        id: 'sa-1',
        companyId: 'co-1',
      });
      prisma.employee.groupBy.mockResolvedValue([]);
      prisma.resignation.count.mockResolvedValue(0);
      prisma.candidate.groupBy.mockResolvedValue([]);
      prisma.jobRequisition.count.mockResolvedValue(0);
      prisma.leaveBalance.findMany.mockResolvedValue([]);

      const result = (await service.getDashboard('sa-1', 'SUPER_ADMIN')) as any;
      expect(result.role).toBe('SUPER_ADMIN');
      expect(result.headcountByStatus).toEqual([]);
    });
  });

  describe('Business Rule: a Manager dashboard never shows data outside their reporting hierarchy', () => {
    it('scopes attendance/goal queries to the recursive reports list only', async () => {
      // mgr-1 -> emp-1 -> emp-2 (indirect report two levels down)
      prisma.employee.findMany
        .mockResolvedValueOnce([{ id: 'emp-1' }])
        .mockResolvedValueOnce([{ id: 'emp-2' }])
        .mockResolvedValueOnce([]);
      prisma.attendanceRecord.groupBy.mockResolvedValue([]);
      prisma.goal.findMany.mockResolvedValue([]);

      await service.getDashboard('mgr-1', 'MANAGER');

      expect(prisma.attendanceRecord.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            employeeId: { in: ['emp-1', 'emp-2'] },
          }),
        }),
      );
      expect(prisma.goal.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { employeeId: { in: ['emp-1', 'emp-2'] } },
        }),
      );
    });

    it('includes indirect (second-level) reports, not just direct reports', async () => {
      prisma.employee.findMany
        .mockResolvedValueOnce([{ id: 'direct-1' }])
        .mockResolvedValueOnce([{ id: 'indirect-1' }])
        .mockResolvedValueOnce([]);
      prisma.attendanceRecord.groupBy.mockResolvedValue([]);
      prisma.goal.findMany.mockResolvedValue([]);

      const result = (await service.getDashboard('mgr-1', 'MANAGER')) as any;
      expect(result.teamSize).toBe(2);
    });

    it('reuses LeaveService.listPendingApprovals scoped to this manager as the approver', async () => {
      prisma.employee.findMany.mockResolvedValue([]);
      prisma.attendanceRecord.groupBy.mockResolvedValue([]);
      prisma.goal.findMany.mockResolvedValue([]);
      leaveService.listPendingApprovals.mockResolvedValue([{ id: 'app-1' }]);

      const result = (await service.getDashboard('mgr-1', 'MANAGER')) as any;
      expect(leaveService.listPendingApprovals).toHaveBeenCalledWith('mgr-1');
      expect(result.pendingApprovalsCount).toBe(1);
    });
  });

  describe('Key Feature: HR Admin sees org-wide headcount/attrition/hiring-funnel/leave-liability', () => {
    it('computes leave liability as a read-only sum over existing balances, without creating any', async () => {
      prisma.employee.findUnique.mockResolvedValue({
        id: 'hr-1',
        companyId: 'co-1',
      });
      prisma.employee.groupBy.mockResolvedValue([
        { status: 'ACTIVE', _count: 3 },
      ]);
      prisma.resignation.count.mockResolvedValue(1);
      prisma.candidate.groupBy.mockResolvedValue([
        { currentStage: 'OFFER', _count: 2 },
      ]);
      prisma.jobRequisition.count.mockResolvedValue(4);
      prisma.leaveBalance.findMany.mockResolvedValue([
        { openingBalance: 2, accrued: 5, carriedForward: 1, used: 3 },
        { openingBalance: 0, accrued: 4, carriedForward: 0, used: 1 },
      ]);

      const result = (await service.getDashboard('hr-1', 'HR_ADMIN')) as any;

      expect(result.leaveLiabilityDays).toBe(2 + 5 + 1 - 3 + (0 + 4 + 0 - 1));
      expect(result.headcountByStatus).toEqual([
        { status: 'ACTIVE', count: 3 },
      ]);
      expect(result.attritionLast90Days).toBe(1);
      expect(result.hiringFunnel).toEqual([{ stage: 'OFFER', count: 2 }]);
      expect(result.openRequisitions).toBe(4);
    });
  });

  describe('Report Builder: whitelisted entity registry (AC-2)', () => {
    it('lists exactly the 5 required entities with their fields/groupableFields', () => {
      const entities = service.listReportEntities();
      const keys = entities.map((e) => e.key);
      expect(keys).toEqual(
        expect.arrayContaining([
          'Employee',
          'Attendance',
          'Leave',
          'ATS',
          'Assets',
        ]),
      );
      const employee = entities.find((e) => e.key === 'Employee');
      expect(employee?.groupableFields).toEqual(
        expect.arrayContaining(['departmentId', 'status']),
      );
    });

    it('rejects an entity outside the whitelist', async () => {
      const dto: BuildReportDto = { entity: 'NotARealEntity' };
      await expect(service.buildReport(dto)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('Employee: applies department/status/date-range filters and projects only requested fields plus id', async () => {
      prisma.employee.findMany.mockResolvedValue([
        {
          id: 'e-1',
          employeeCode: 'E001',
          firstName: 'Ada',
          lastName: 'Lovelace',
          departmentId: 'dept-1',
          status: 'ACTIVE',
          dateOfJoining: new Date('2024-01-01'),
        },
      ]);

      const result = await service.buildReport({
        entity: 'Employee',
        fields: ['firstName', 'status'],
        departmentId: 'dept-1',
        status: 'ACTIVE',
        dateFrom: '2023-01-01',
        dateTo: '2025-01-01',
      });

      expect(prisma.employee.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            departmentId: 'dept-1',
            status: 'ACTIVE',
            dateOfJoining: {
              gte: new Date('2023-01-01'),
              lte: new Date('2025-01-01'),
            },
          }),
        }),
      );
      expect(result.rows).toEqual([
        { id: 'e-1', firstName: 'Ada', status: 'ACTIVE' },
      ]);
      expect(result.total).toBe(1);
    });

    it('Attendance: filters by department via the employee relation and by status', async () => {
      prisma.attendanceRecord.findMany.mockResolvedValue([
        { id: 'a-1', employeeId: 'e-1', date: new Date(), status: 'PRESENT' },
      ]);

      await service.buildReport({
        entity: 'Attendance',
        departmentId: 'dept-1',
        status: 'PRESENT',
      });

      expect(prisma.attendanceRecord.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            employee: { departmentId: 'dept-1' },
            status: 'PRESENT',
          }),
        }),
      );
    });

    it('Leave: filters by start-date range and groups by status with recordIds', async () => {
      prisma.leaveApplication.findMany.mockResolvedValue([
        { id: 'l-1', employeeId: 'e-1', status: 'APPROVED' },
        { id: 'l-2', employeeId: 'e-2', status: 'APPROVED' },
        { id: 'l-3', employeeId: 'e-3', status: 'PENDING' },
      ]);

      const result = await service.buildReport({
        entity: 'Leave',
        groupBy: 'status',
      });

      expect(result.groups).toEqual(
        expect.arrayContaining([
          { key: 'APPROVED', count: 2, recordIds: ['l-1', 'l-2'] },
          { key: 'PENDING', count: 1, recordIds: ['l-3'] },
        ]),
      );
    });

    it('ATS: maps to Candidate, filtering currentStage via the status param', async () => {
      prisma.candidate.findMany.mockResolvedValue([
        { id: 'c-1', name: 'Grace Hopper', currentStage: 'OFFER' },
      ]);

      await service.buildReport({ entity: 'ATS', status: 'OFFER' });

      expect(prisma.candidate.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ currentStage: 'OFFER' }),
        }),
      );
    });

    it('Assets: reaches department only through an active (unreturned) assignment', async () => {
      prisma.asset.findMany.mockResolvedValue([
        { id: 'as-1', category: 'LAPTOP', status: 'ASSIGNED' },
      ]);

      await service.buildReport({
        entity: 'Assets',
        departmentId: 'dept-1',
      });

      expect(prisma.asset.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            assignments: {
              some: { employee: { departmentId: 'dept-1' }, returnedAt: null },
            },
          }),
        }),
      );
    });

    it('every row keeps its id for drill-down even when fields are restricted', async () => {
      prisma.employee.findMany.mockResolvedValue([
        { id: 'e-1', firstName: 'Ada' },
      ]);

      const result = await service.buildReport({
        entity: 'Employee',
        fields: ['firstName'],
      });

      expect(result.rows[0]).toHaveProperty('id', 'e-1');
    });

    it('ignores an unknown groupBy field rather than throwing', async () => {
      prisma.employee.findMany.mockResolvedValue([{ id: 'e-1' }]);

      const result = await service.buildReport({
        entity: 'Employee',
        groupBy: 'notAGroupableField',
      });

      expect(result.groups).toBeUndefined();
    });
  });

  describe('Scheduled Reports (Phase 5): SavedReport persists only scheduled reports', () => {
    it('createSavedReport stores config/schedule/recipients against the creating actor', async () => {
      prisma.savedReport.create.mockResolvedValue({ id: 'sr-1' });

      await service.createSavedReport(
        {
          name: 'Weekly headcount',
          config: { entity: 'Employee' },
          schedule: 'WEEKLY',
          recipientIds: ['emp-1', 'emp-2'],
        },
        'hr-1',
      );

      expect(prisma.savedReport.create).toHaveBeenCalledWith({
        data: {
          name: 'Weekly headcount',
          config: { entity: 'Employee' },
          schedule: 'WEEKLY',
          recipientIds: ['emp-1', 'emp-2'],
          createdById: 'hr-1',
        },
      });
    });

    it('deleteSavedReport removes the record by id', async () => {
      prisma.savedReport.delete.mockResolvedValue({ id: 'sr-1' });
      await service.deleteSavedReport('sr-1');
      expect(prisma.savedReport.delete).toHaveBeenCalledWith({
        where: { id: 'sr-1' },
      });
    });

    it('a report with no lastRunAt is treated as due', async () => {
      prisma.savedReport.findMany.mockResolvedValue([
        {
          id: 'sr-1',
          name: 'Report',
          config: { entity: 'Employee' },
          schedule: 'DAILY',
          recipientIds: ['hr-1'],
          lastRunAt: null,
        },
      ]);
      prisma.employee.findMany.mockResolvedValue([
        { id: 'hr-1', role: 'HR_ADMIN' },
      ]);
      prisma.savedReport.update.mockResolvedValue({});

      const due = await service.findDueScheduledReports();
      expect(due).toHaveLength(1);
      expect(prisma.savedReport.update).toHaveBeenCalledWith({
        where: { id: 'sr-1' },
        data: { lastRunAt: expect.any(Date) },
      });
    });

    it('a DAILY report that already ran within the last 24h is skipped', async () => {
      prisma.savedReport.findMany.mockResolvedValue([
        {
          id: 'sr-1',
          name: 'Report',
          config: { entity: 'Employee' },
          schedule: 'DAILY',
          recipientIds: ['hr-1'],
          lastRunAt: new Date(Date.now() - 60 * 60 * 1000), // 1h ago
        },
      ]);

      const due = await service.findDueScheduledReports();
      expect(due).toHaveLength(0);
      expect(prisma.savedReport.update).not.toHaveBeenCalled();
    });

    it("AC-3: drops recipients who no longer hold HR_ADMIN/SUPER_ADMIN access, re-checked at send time — never trusting the schedule's creation-time snapshot", async () => {
      prisma.savedReport.findMany.mockResolvedValue([
        {
          id: 'sr-1',
          name: 'Weekly headcount',
          config: { entity: 'Employee' },
          schedule: 'WEEKLY',
          recipientIds: ['hr-1', 'demoted-1', 'left-1'],
          lastRunAt: null,
        },
      ]);
      prisma.employee.findMany.mockImplementation((args) => {
        if (args?.where?.id?.in) {
          // 'left-1' is absent entirely — the employee no longer exists
          return Promise.resolve([
            { id: 'hr-1', role: 'HR_ADMIN' },
            { id: 'demoted-1', role: 'EMPLOYEE' },
          ]);
        }
        return Promise.resolve([]);
      });
      prisma.savedReport.update.mockResolvedValue({});

      const due = await service.findDueScheduledReports();
      expect(due).toHaveLength(1);
      expect(due[0].recipientCount).toBe(3);
      expect(due[0].validRecipientIds).toEqual(['hr-1']);
    });
  });
});
