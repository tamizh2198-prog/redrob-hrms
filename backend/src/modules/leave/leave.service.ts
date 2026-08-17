import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  LeaveAccrualFrequency,
  LeaveApplicationStatus,
  Role,
} from '@prisma/client';
import { PrismaService } from '../../shared/database/prisma.service';
import { DefaultCompanyService } from '../../shared/database/default-company.service';
import { NotificationService } from '../../shared/notifications/notification.service';
import { CalendarService } from '../../shared/calendar/calendar.service';
import { AttendanceService } from '../attendance/attendance.service';
import {
  assertCanAccessEmployeeData,
  type EmployeeDataRequester,
} from '../../shared/employee/reporting-hierarchy.util';
import { CreateLeaveTypeDto } from './dto/create-leave-type.dto';
import { ApplyLeaveDto } from './dto/apply-leave.dto';
import { LeaveDecisionDto } from './dto/leave-decision.dto';

// Beyond this many consecutive days, an application needs a second approval
// level (Section 7.3 Business Rules: "e.g., Manager → Skip-level for > 5
// consecutive days").
const CONSECUTIVE_DAY_ESCALATION_THRESHOLD = 5;

// Normalizes to UTC midnight, not local midnight — see calendar.service.ts
// for why: date-only ISO strings parse as UTC, so a local boundary here
// would shift every stored date key by a day outside UTC+0 servers.
function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function isPrivileged(role?: Role): boolean {
  return role === Role.HR_ADMIN || role === Role.SUPER_ADMIN;
}

function eachDate(start: Date, end: Date): Date[] {
  const dates: Date[] = [];
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    dates.push(new Date(d));
  }
  return dates;
}

@Injectable()
export class LeaveService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly defaultCompany: DefaultCompanyService,
    private readonly notifications: NotificationService,
    private readonly calendar: CalendarService,
    private readonly attendance: AttendanceService,
  ) {}

  async createLeaveType(dto: CreateLeaveTypeDto) {
    const companyId =
      dto.companyId ?? (await this.defaultCompany.getOrCreate());
    return this.prisma.leaveType.create({
      data: {
        companyId,
        name: dto.name,
        code: dto.code,
        accrualFrequency: dto.accrualFrequency,
        accrualRate: dto.accrualRate,
        maxCarryForward: dto.maxCarryForward,
        isEncashable: dto.isEncashable,
        requiresDocumentAfterDays: dto.requiresDocumentAfterDays,
        allowsNegativeBalance: dto.allowsNegativeBalance,
      },
    });
  }

  listLeaveTypes() {
    return this.prisma.leaveType.findMany({ orderBy: { name: 'asc' } });
  }

  private async getOrCreateBalance(
    employeeId: string,
    leaveTypeId: string,
    year: number,
  ) {
    const existing = await this.prisma.leaveBalance.findUnique({
      where: { employeeId_leaveTypeId_year: { employeeId, leaveTypeId, year } },
    });
    if (existing) return existing;
    return this.prisma.leaveBalance.create({
      data: { employeeId, leaveTypeId, year },
    });
  }

  // Lazily creates the per-company "Comp Off" leave type on first use,
  // rather than seeding it ahead of time — mirrors DefaultCompanyService's
  // own getOrCreate() pattern. accrualRate/accrualFrequency are irrelevant
  // here since isCompOff: true excludes it from runMonthlyAccrual() above.
  private async getOrCreateCompOffLeaveType(companyId: string) {
    const existing = await this.prisma.leaveType.findFirst({
      where: { companyId, isCompOff: true },
    });
    if (existing) return existing;
    return this.prisma.leaveType.create({
      data: {
        companyId,
        name: 'Comp Off',
        code: 'CO',
        accrualFrequency: 'MONTHLY',
        accrualRate: 0,
        isCompOff: true,
        maxCarryForward: 0,
        isEncashable: false,
        allowsNegativeBalance: false,
      },
    });
  }

  // Called by CompOffService when a comp-off request is approved — the
  // single place LeaveBalance.accrued is touched for comp-off, same
  // single-source-of-truth style as every other balance mutation here.
  async creditCompOffDay(employeeId: string): Promise<void> {
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
    });
    if (!employee) throw new NotFoundException('Employee not found');
    const leaveType = await this.getOrCreateCompOffLeaveType(
      employee.companyId,
    );
    const balance = await this.getOrCreateBalance(
      employeeId,
      leaveType.id,
      new Date().getFullYear(),
    );
    await this.prisma.leaveBalance.update({
      where: { id: balance.id },
      data: { accrued: balance.accrued + 1 },
    });
  }

  async getBalances(
    employeeId: string,
    year: number,
    requester: EmployeeDataRequester,
  ) {
    await assertCanAccessEmployeeData(this.prisma, employeeId, requester);
    const leaveTypes = await this.prisma.leaveType.findMany();
    return Promise.all(
      leaveTypes.map(async (lt) => {
        const balance = await this.getOrCreateBalance(employeeId, lt.id, year);
        const available =
          balance.openingBalance +
          balance.accrued +
          balance.carriedForward -
          balance.used;
        return { leaveType: lt, balance, available };
      }),
    );
  }

  // Section 7.3 Acceptance Criteria: "Accrual engine correctly pro-rates for
  // an employee joining mid-month." Quarterly-frequency types (e.g. Sick
  // Leave, Care Leave) only accrue when `month` starts a quarter (Jan/Apr/
  // Jul/Oct) and pro-rate against the full 3-month quarter, not the month.
  async runMonthlyAccrual(year: number, month: number) {
    const isQuarterStart = (month - 1) % 3 === 0;
    const frequencies: LeaveAccrualFrequency[] = isQuarterStart
      ? [LeaveAccrualFrequency.MONTHLY, LeaveAccrualFrequency.QUARTERLY]
      : [LeaveAccrualFrequency.MONTHLY];
    // isCompOff leave types are credited one-time by CompOffService on
    // approval, never on this recurring cadence — excluding them here is
    // what prevents the cron from double-crediting/clobbering them.
    const leaveTypes = await this.prisma.leaveType.findMany({
      where: { accrualFrequency: { in: frequencies }, isCompOff: false },
    });
    const employees = await this.prisma.employee.findMany({
      where: { status: { in: ['ACTIVE', 'ACTIVE_PROBATION'] } },
    });

    const monthStart = new Date(Date.UTC(year, month - 1, 1));
    const monthEnd = new Date(Date.UTC(year, month, 0));
    const quarterEnd = new Date(Date.UTC(year, month + 2, 0));
    const MS_PER_DAY = 24 * 60 * 60 * 1000;

    let accrualsRun = 0;
    for (const leaveType of leaveTypes) {
      const periodStart = monthStart;
      const periodEnd =
        leaveType.accrualFrequency === 'QUARTERLY' ? quarterEnd : monthEnd;
      const totalDaysInPeriod =
        Math.round((periodEnd.getTime() - periodStart.getTime()) / MS_PER_DAY) +
        1;

      for (const employee of employees) {
        const balance = await this.getOrCreateBalance(
          employee.id,
          leaveType.id,
          year,
        );

        let accrualAmount = leaveType.accrualRate;
        if (
          employee.dateOfJoining &&
          employee.dateOfJoining >= periodStart &&
          employee.dateOfJoining <= periodEnd
        ) {
          const daysWorked =
            Math.round(
              (periodEnd.getTime() - employee.dateOfJoining.getTime()) /
                MS_PER_DAY,
            ) + 1;
          accrualAmount =
            leaveType.accrualRate * (daysWorked / totalDaysInPeriod);
        } else if (
          employee.dateOfJoining &&
          employee.dateOfJoining > periodEnd
        ) {
          continue;
        }

        await this.prisma.leaveBalance.update({
          where: { id: balance.id },
          data: { accrued: balance.accrued + accrualAmount },
        });
        accrualsRun++;
      }
    }
    return { accrualsRun, year, month };
  }

  private async countDeductibleDays(
    employeeId: string,
    start: Date,
    end: Date,
  ): Promise<number> {
    const dates = eachDate(start, end);
    let count = 0;
    for (const date of dates) {
      const nonWorking = await this.calendar.isNonWorkingDay(employeeId, date);
      if (!nonWorking) count++;
    }
    return count;
  }

  private async findHrAdminId(excludeId?: string): Promise<string | null> {
    const hrAdmin = await this.prisma.employee.findFirst({
      where: {
        role: { in: [Role.HR_ADMIN, Role.SUPER_ADMIN] },
        ...(excludeId && { id: { not: excludeId } }),
      },
    });
    return hrAdmin?.id ?? null;
  }

  async applyLeave(employeeId: string, dto: ApplyLeaveDto) {
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
    });
    if (!employee) throw new NotFoundException('Employee not found');

    const leaveType = await this.prisma.leaveType.findUnique({
      where: { id: dto.leaveTypeId },
    });
    if (!leaveType) throw new NotFoundException('Leave type not found');

    const startDate = startOfDay(new Date(dto.startDate));
    const endDate = startOfDay(new Date(dto.endDate));
    if (endDate < startDate) {
      throw new BadRequestException('endDate cannot be before startDate');
    }

    // Phase 6E: half-day is a DURATION, not a separate LeaveType — it only
    // ever applies to a single date, since "half of a multi-day range"
    // isn't a coherent request.
    const isHalfDay = dto.duration === 'HALF_DAY';
    if (isHalfDay && startDate.getTime() !== endDate.getTime()) {
      throw new BadRequestException(
        'Half-day leave can only be applied for a single date',
      );
    }

    // Business Rule: applications overlapping an already-approved/pending
    // leave are rejected rather than silently adjusted. Unchanged for
    // half-day — the same date-range overlap check already catches a
    // half-day request landing on a date that's already leave-covered.
    const overlapping = await this.prisma.leaveApplication.findFirst({
      where: {
        employeeId,
        status: {
          in: [LeaveApplicationStatus.PENDING, LeaveApplicationStatus.APPROVED],
        },
        startDate: { lte: endDate },
        endDate: { gte: startDate },
      },
    });
    if (overlapping) {
      throw new BadRequestException(
        'This application overlaps an existing pending or approved leave application',
      );
    }

    let daysCount: number;
    if (isHalfDay) {
      const nonWorking = await this.calendar.isNonWorkingDay(
        employeeId,
        startDate,
      );
      if (nonWorking) {
        throw new BadRequestException(
          'This date is not a working day (holiday/week-off)',
        );
      }
      daysCount = 0.5;
    } else {
      daysCount = await this.countDeductibleDays(
        employeeId,
        startDate,
        endDate,
      );
      if (daysCount === 0) {
        throw new BadRequestException(
          'This range contains no deductible days (all holidays/week-offs)',
        );
      }
    }

    const year = startDate.getFullYear();
    const balance = await this.getOrCreateBalance(
      employeeId,
      dto.leaveTypeId,
      year,
    );
    const available =
      balance.openingBalance +
      balance.accrued +
      balance.carriedForward -
      balance.used;
    if (daysCount > available && !leaveType.allowsNegativeBalance) {
      await this.notifications.send({
        recipientId: employeeId,
        template: 'leave.insufficient-balance',
        body: `You don't have enough ${leaveType.name} balance: requested ${daysCount}, available ${available}.`,
        data: { leaveTypeId: dto.leaveTypeId, requested: daysCount, available },
      });
      throw new BadRequestException(
        `Insufficient balance: requested ${daysCount}, available ${available}`,
      );
    }

    // This task: an employee with no reportingManagerId (e.g. Super Admin)
    // previously got an empty approvalSteps array — the application sat
    // PENDING forever with no one able to decide it. Reuses the existing
    // HR/Super Admin lookup already used for the >5-day escalation case
    // below, excluding the applicant themselves — never inventing a new
    // approver concept. If no other HR Admin/Super Admin exists at all,
    // fail explicitly rather than silently leaving it undecidable.
    let firstApproverId = employee.reportingManagerId;
    if (!firstApproverId) {
      firstApproverId = await this.findHrAdminId(employeeId);
      if (!firstApproverId) {
        throw new BadRequestException(
          'No approver is configured for this employee: they have no reporting manager, and no other HR Admin/Super Admin exists in the company to fall back to. Assign a reporting manager, or add a second HR Admin/Super Admin, before applying for leave.',
        );
      }
    }

    const approverIds: (string | null)[] = [firstApproverId];
    if (daysCount > CONSECUTIVE_DAY_ESCALATION_THRESHOLD) {
      const manager = employee.reportingManagerId
        ? await this.prisma.employee.findUnique({
            where: { id: employee.reportingManagerId },
          })
        : null;
      approverIds.push(
        manager?.reportingManagerId ?? (await this.findHrAdminId()),
      );
    }

    const application = await this.prisma.leaveApplication.create({
      data: {
        employeeId,
        leaveTypeId: dto.leaveTypeId,
        startDate,
        endDate,
        daysCount,
        reason: dto.reason,
        currentApproverId: approverIds[0] ?? undefined,
        approvalSteps: {
          create: approverIds
            .filter((id): id is string => !!id)
            .map((approverId, index) => ({ approverId, sequence: index + 1 })),
        },
      },
      include: { approvalSteps: true },
    });

    if (approverIds[0]) {
      await this.notifications.send({
        recipientId: approverIds[0],
        template: 'leave.application-submitted',
        body: `${employee.firstName} ${employee.lastName} applied for ${leaveType.name} leave from ${startDate.toISOString().slice(0, 10)} to ${endDate.toISOString().slice(0, 10)} and is awaiting your approval.`,
        data: { applicationId: application.id },
      });
    }

    return application;
  }

  async decideLeave(
    applicationId: string,
    actorId: string,
    dto: LeaveDecisionDto,
    actorRole?: Role,
  ) {
    const application = await this.prisma.leaveApplication.findUnique({
      where: { id: applicationId },
      include: {
        approvalSteps: { orderBy: { sequence: 'asc' } },
        employee: true,
        leaveType: true,
      },
    });
    if (!application)
      throw new NotFoundException('Leave application not found');
    if (application.status !== LeaveApplicationStatus.PENDING) {
      throw new BadRequestException('This application was already decided');
    }

    const currentStep = application.approvalSteps.find(
      (s) => s.decision === 'PENDING',
    );
    if (!currentStep) {
      throw new BadRequestException('No pending approval step found');
    }
    if (currentStep.approverId !== actorId && !isPrivileged(actorRole)) {
      throw new ForbiddenException('Not authorized to decide this application');
    }

    if (!dto.approve) {
      await this.prisma.$transaction([
        this.prisma.leaveApprovalStep.update({
          where: { id: currentStep.id },
          data: {
            decision: 'REJECTED',
            decidedAt: new Date(),
            comment: dto.comment,
          },
        }),
        this.prisma.leaveApplication.update({
          where: { id: applicationId },
          data: { status: LeaveApplicationStatus.REJECTED },
        }),
      ]);
      await this.notifications.send({
        recipientId: application.employeeId,
        template: 'leave.decision-made',
        body: `Your ${application.leaveType.name} leave request from ${application.startDate.toISOString().slice(0, 10)} to ${application.endDate.toISOString().slice(0, 10)} was rejected.${dto.comment ? ` Comment: "${dto.comment}"` : ''}`,
        data: { status: 'REJECTED', comment: dto.comment },
      });
      return { status: 'REJECTED' };
    }

    const nextStep = application.approvalSteps.find(
      (s) => s.sequence === currentStep.sequence + 1,
    );

    await this.prisma.leaveApprovalStep.update({
      where: { id: currentStep.id },
      data: {
        decision: 'APPROVED',
        decidedAt: new Date(),
        comment: dto.comment,
      },
    });

    if (nextStep) {
      await this.prisma.leaveApplication.update({
        where: { id: applicationId },
        data: { currentApproverId: nextStep.approverId },
      });
      await this.notifications.send({
        recipientId: nextStep.approverId,
        template: 'leave.application-submitted',
        body: `${application.employee.firstName} ${application.employee.lastName}'s ${application.leaveType.name} leave request from ${application.startDate.toISOString().slice(0, 10)} to ${application.endDate.toISOString().slice(0, 10)} needs your approval.`,
        data: { applicationId },
      });
      return { status: 'PENDING', nextApproverId: nextStep.approverId };
    }

    // Final approval: debit balance, mark Approved, sync Attendance.
    const year = application.startDate.getFullYear();
    const balance = await this.getOrCreateBalance(
      application.employeeId,
      application.leaveTypeId,
      year,
    );
    await this.prisma.$transaction([
      this.prisma.leaveBalance.update({
        where: { id: balance.id },
        data: { used: balance.used + application.daysCount },
      }),
      this.prisma.leaveApplication.update({
        where: { id: applicationId },
        data: {
          status: LeaveApplicationStatus.APPROVED,
          currentApproverId: null,
        },
      }),
    ]);

    await this.attendance.syncLeaveStatus(
      application.employeeId,
      eachDate(application.startDate, application.endDate),
      true,
    );

    await this.notifications.send({
      recipientId: application.employeeId,
      template: 'leave.decision-made',
      body: `Your ${application.leaveType.name} leave request from ${application.startDate.toISOString().slice(0, 10)} to ${application.endDate.toISOString().slice(0, 10)} was approved.`,
      data: { status: 'APPROVED' },
    });

    return { status: 'APPROVED' };
  }

  async cancelLeave(applicationId: string, actorId: string, actorRole?: Role) {
    const application = await this.prisma.leaveApplication.findUnique({
      where: { id: applicationId },
    });
    if (!application)
      throw new NotFoundException('Leave application not found');
    if (application.status !== LeaveApplicationStatus.APPROVED) {
      throw new BadRequestException(
        'Only an approved application can be cancelled',
      );
    }
    if (application.startDate <= startOfDay(new Date())) {
      throw new BadRequestException(
        'Cannot cancel a leave that has already started',
      );
    }

    const employee = await this.prisma.employee.findUnique({
      where: { id: application.employeeId },
    });
    const isSelf = application.employeeId === actorId;
    const isManager = employee?.reportingManagerId === actorId;
    if (!isSelf && !isManager && !isPrivileged(actorRole)) {
      throw new ForbiddenException('Not authorized to cancel this application');
    }

    const year = application.startDate.getFullYear();
    const balance = await this.getOrCreateBalance(
      application.employeeId,
      application.leaveTypeId,
      year,
    );

    await this.prisma.$transaction([
      this.prisma.leaveBalance.update({
        where: { id: balance.id },
        data: { used: Math.max(0, balance.used - application.daysCount) },
      }),
      this.prisma.leaveApplication.update({
        where: { id: applicationId },
        data: { status: LeaveApplicationStatus.CANCELLED },
      }),
    ]);

    await this.attendance.syncLeaveStatus(
      application.employeeId,
      eachDate(application.startDate, application.endDate),
      false,
    );

    const approverIds = await this.prisma.leaveApprovalStep.findMany({
      where: { applicationId },
      select: { approverId: true },
    });
    await Promise.all(
      [application.employeeId, ...approverIds.map((a) => a.approverId)].map(
        (id) =>
          this.notifications.send({
            recipientId: id,
            template: 'leave.cancelled',
            body: `The leave application from ${application.startDate.toISOString().slice(0, 10)} to ${application.endDate.toISOString().slice(0, 10)} for ${employee ? `${employee.firstName} ${employee.lastName}` : 'this employee'} was cancelled.`,
          }),
      ),
    );

    return { status: 'CANCELLED' };
  }

  async listMyApplications(employeeId: string) {
    return this.prisma.leaveApplication.findMany({
      where: { employeeId },
      include: { leaveType: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  // This task: passwordHash was being returned unstripped through every
  // method here that includes `employee` — discovered live while testing
  // the new pending-requests admin view. Fixed at the one place all three
  // affected methods can share it, rather than three separate patches.
  private stripEmployeePasswordHash<
    T extends { employee?: { passwordHash?: string | null } | null },
  >(applications: T[]): T[] {
    return applications.map((application) => {
      if (!application.employee) return application;
      const safeEmployee: Record<string, unknown> = { ...application.employee };
      delete safeEmployee.passwordHash;
      return { ...application, employee: safeEmployee };
    });
  }

  async listPendingApprovals(approverId: string) {
    const applications = await this.prisma.leaveApplication.findMany({
      where: {
        status: LeaveApplicationStatus.PENDING,
        approvalSteps: { some: { approverId, decision: 'PENDING' } },
      },
      include: { employee: true, leaveType: true },
      orderBy: { createdAt: 'desc' },
    });
    return this.stripEmployeePasswordHash(applications);
  }

  // Phase 6A: unlike listPendingApprovals above (scoped to one assigned
  // approver), this is the company-wide list — SUPER_ADMIN is already an
  // authorized decider for any pending application via decideLeave()'s
  // isPrivileged() escalation, but had no way to see the full list before
  // this. Controller restricts this to SUPER_ADMIN.
  async listAllPendingApplications() {
    const applications = await this.prisma.leaveApplication.findMany({
      where: { status: LeaveApplicationStatus.PENDING },
      include: { employee: true, leaveType: true },
      orderBy: { createdAt: 'desc' },
    });
    return this.stripEmployeePasswordHash(applications);
  }

  // Phase 6B: reuses the exact same authorization shape already used by
  // cancelLeave() above (self, privileged, or the employee's direct
  // manager) rather than inventing a new scope rule.
  private async assertCanViewLeaveHistory(
    employeeId: string,
    actorId: string,
    actorRole?: Role,
  ): Promise<void> {
    if (isPrivileged(actorRole)) return;
    if (actorId === employeeId) return;
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      select: { reportingManagerId: true },
    });
    if (employee?.reportingManagerId === actorId) return;
    throw new ForbiddenException(
      "Not authorized to view this employee's leave history",
    );
  }

  async listApplicationsForEmployee(
    employeeId: string,
    actorId: string,
    actorRole?: Role,
  ) {
    await this.assertCanViewLeaveHistory(employeeId, actorId, actorRole);
    return this.listMyApplications(employeeId);
  }

  async getTeamCalendar(managerId: string, from: Date, to: Date) {
    const reports = await this.prisma.employee.findMany({
      where: { reportingManagerId: managerId },
      select: { id: true },
    });
    const applications = await this.prisma.leaveApplication.findMany({
      where: {
        employeeId: { in: reports.map((r) => r.id) },
        status: LeaveApplicationStatus.APPROVED,
        startDate: { lte: to },
        endDate: { gte: from },
      },
      include: { employee: true, leaveType: true },
    });
    return this.stripEmployeePasswordHash(applications);
  }

  // Section 7.3 Acceptance Criteria: "Carry-forward cap and auto-encashment/
  // lapse are applied correctly at year-end close."
  async runYearEndClose(year: number) {
    const balances = await this.prisma.leaveBalance.findMany({
      where: { year },
      include: { leaveType: true },
    });

    let processed = 0;
    for (const balance of balances) {
      const closing = balance.openingBalance + balance.accrued - balance.used;
      const carryForward = Math.min(
        Math.max(closing, 0),
        balance.leaveType.maxCarryForward,
      );
      const excess = Math.max(closing - carryForward, 0);

      await this.prisma.leaveBalance.upsert({
        where: {
          employeeId_leaveTypeId_year: {
            employeeId: balance.employeeId,
            leaveTypeId: balance.leaveTypeId,
            year: year + 1,
          },
        },
        update: { openingBalance: carryForward, carriedForward: carryForward },
        create: {
          employeeId: balance.employeeId,
          leaveTypeId: balance.leaveTypeId,
          year: year + 1,
          openingBalance: carryForward,
          carriedForward: carryForward,
        },
      });

      if (excess > 0 && balance.leaveType.isEncashable) {
        await this.notifications.send({
          recipientId: balance.employeeId,
          template: 'leave.year-end-encashment',
          body: `${excess} day(s) of your unused ${balance.leaveType.name} leave for ${year} will be encashed.`,
          data: { amount: excess, leaveTypeId: balance.leaveTypeId },
        });
        await this.notifications.send({
          recipientId: 'hr-admin',
          template: 'leave.year-end-encashment',
          body: `${excess} day(s) of unused ${balance.leaveType.name} leave for employee ${balance.employeeId} will be encashed for year-end ${year} close.`,
          data: { employeeId: balance.employeeId, amount: excess },
        });
      }
      processed++;
    }
    return { processed, year };
  }
}
