import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { LeaveApplicationStatus, Role } from '@prisma/client';
import { PrismaService } from '../../shared/database/prisma.service';
import { DefaultCompanyService } from '../../shared/database/default-company.service';
import { NotificationService } from '../../shared/notifications/notification.service';
import { CalendarService } from '../../shared/calendar/calendar.service';
import { AttendanceService } from '../attendance/attendance.service';
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

  async getBalances(employeeId: string, year: number) {
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
  // an employee joining mid-month."
  async runMonthlyAccrual(year: number, month: number) {
    const leaveTypes = await this.prisma.leaveType.findMany({
      where: { accrualFrequency: 'MONTHLY' },
    });
    const employees = await this.prisma.employee.findMany({
      where: { status: { in: ['ACTIVE', 'ACTIVE_PROBATION'] } },
    });

    const monthStart = new Date(Date.UTC(year, month - 1, 1));
    const monthEnd = new Date(Date.UTC(year, month, 0));
    const totalDaysInMonth = monthEnd.getUTCDate();

    let accrualsRun = 0;
    for (const employee of employees) {
      for (const leaveType of leaveTypes) {
        const balance = await this.getOrCreateBalance(
          employee.id,
          leaveType.id,
          year,
        );

        let accrualAmount = leaveType.accrualRate;
        if (
          employee.dateOfJoining &&
          employee.dateOfJoining >= monthStart &&
          employee.dateOfJoining <= monthEnd
        ) {
          const daysWorked =
            totalDaysInMonth - employee.dateOfJoining.getUTCDate() + 1;
          accrualAmount =
            leaveType.accrualRate * (daysWorked / totalDaysInMonth);
        } else if (
          employee.dateOfJoining &&
          employee.dateOfJoining > monthEnd
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

  private async findHrAdminId(): Promise<string | null> {
    const hrAdmin = await this.prisma.employee.findFirst({
      where: { role: { in: [Role.HR_ADMIN, Role.SUPER_ADMIN] } },
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

    // Business Rule: applications overlapping an already-approved/pending
    // leave are rejected rather than silently adjusted.
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

    const daysCount = await this.countDeductibleDays(
      employeeId,
      startDate,
      endDate,
    );
    if (daysCount === 0) {
      throw new BadRequestException(
        'This range contains no deductible days (all holidays/week-offs)',
      );
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
        data: { leaveTypeId: dto.leaveTypeId, requested: daysCount, available },
      });
      throw new BadRequestException(
        `Insufficient balance: requested ${daysCount}, available ${available}`,
      );
    }

    const approverIds: (string | null)[] = [employee.reportingManagerId];
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
      include: { approvalSteps: { orderBy: { sequence: 'asc' } } },
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

  async listPendingApprovals(approverId: string) {
    return this.prisma.leaveApplication.findMany({
      where: {
        status: LeaveApplicationStatus.PENDING,
        approvalSteps: { some: { approverId, decision: 'PENDING' } },
      },
      include: { employee: true, leaveType: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getTeamCalendar(managerId: string, from: Date, to: Date) {
    const reports = await this.prisma.employee.findMany({
      where: { reportingManagerId: managerId },
      select: { id: true },
    });
    return this.prisma.leaveApplication.findMany({
      where: {
        employeeId: { in: reports.map((r) => r.id) },
        status: LeaveApplicationStatus.APPROVED,
        startDate: { lte: to },
        endDate: { gte: from },
      },
      include: { employee: true, leaveType: true },
    });
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
          data: { amount: excess, leaveTypeId: balance.leaveTypeId },
        });
        await this.notifications.send({
          recipientId: 'hr-admin',
          template: 'leave.year-end-encashment',
          data: { employeeId: balance.employeeId, amount: excess },
        });
      }
      processed++;
    }
    return { processed, year };
  }
}
