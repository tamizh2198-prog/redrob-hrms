import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ClearanceDepartment,
  ClearanceStatus,
  Prisma,
  Role,
  SettlementStatus,
} from '@prisma/client';
import { PrismaService } from '../../shared/database/prisma.service';
import { NotificationService } from '../../shared/notifications/notification.service';
import { LeaveService } from '../leave/leave.service';
import { AssetsService } from '../assets/assets.service';
import { SubmitResignationDto } from './dto/submit-resignation.dto';
import { AdjustLwdDto } from './dto/adjust-lwd.dto';
import { SignoffClearanceDto } from './dto/signoff-clearance.dto';
import { SubmitExitInterviewDto } from './dto/submit-exit-interview.dto';
import { ComputeSettlementDto } from './dto/compute-settlement.dto';
import { MarkSettlementPaidDto } from './dto/mark-settlement-paid.dto';

// Normalizes to UTC midnight, not local midnight — see calendar.service.ts
// for why: date-only ISO strings parse as UTC, so a local boundary here
// would shift every stored date key by a day outside UTC+0 servers.
function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

function daysBetween(from: Date, to: Date): number {
  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  return Math.round((to.getTime() - from.getTime()) / MS_PER_DAY);
}

function isPrivileged(role?: Role): boolean {
  return role === Role.HR_ADMIN || role === Role.SUPER_ADMIN;
}

const CLEARANCE_DEPARTMENTS: ClearanceDepartment[] = [
  ClearanceDepartment.IT,
  ClearanceDepartment.FINANCE,
  ClearanceDepartment.ADMIN,
  ClearanceDepartment.HR,
];

@Injectable()
export class OffboardingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
    private readonly leaveService: LeaveService,
    private readonly assetsService: AssetsService,
  ) {}

  // Section 7.10 Key Feature: "auto-computed last working day (LWD)" and
  // "Multi-department clearance checklist ... auto-generated."
  async submitResignation(
    dto: SubmitResignationDto,
    actorId: string,
    actorRole?: Role,
  ) {
    const employeeId = dto.employeeId ?? actorId;
    if (employeeId !== actorId && !isPrivileged(actorRole)) {
      throw new ForbiddenException(
        'Only the employee themselves or HR Admin can submit this resignation',
      );
    }

    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
    });
    if (!employee) throw new NotFoundException('Employee not found');

    const submittedDate = startOfDay(new Date());
    const lastWorkingDay = addDays(submittedDate, dto.noticePeriodDays);

    const resignation = await this.prisma.resignation.create({
      data: {
        employeeId,
        submittedDate,
        noticePeriodDays: dto.noticePeriodDays,
        lastWorkingDay,
        status: 'CLEARANCE_IN_PROGRESS',
        clearanceItems: {
          create: CLEARANCE_DEPARTMENTS.map((department) => ({ department })),
        },
      },
      include: { clearanceItems: true },
    });

    const notifyTargets = [employee.reportingManagerId, 'hr-admin'].filter(
      (id): id is string => !!id,
    );
    await Promise.all(
      notifyTargets.map((recipientId) =>
        this.notifications.send({
          recipientId,
          template: 'offboarding.resignation-submitted',
          data: { resignationId: resignation.id, employeeId },
        }),
      ),
    );

    return resignation;
  }

  getResignation(resignationId: string) {
    return this.prisma.resignation.findUnique({
      where: { id: resignationId },
      include: { clearanceItems: true, lwdAdjustments: true },
    });
  }

  listResignations() {
    return this.prisma.resignation.findMany({
      include: { clearanceItems: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  // Section 7.10 Business Rule: "adjustable via mutual negotiation with
  // manager+HR Admin sign-off and audit trail" — either the employee's
  // manager or HR Admin can record the negotiated date; the row itself is
  // the audit trail.
  async adjustLwd(
    resignationId: string,
    dto: AdjustLwdDto,
    actorId: string,
    actorRole?: Role,
  ) {
    const resignation = await this.prisma.resignation.findUnique({
      where: { id: resignationId },
      include: { employee: true },
    });
    if (!resignation) throw new NotFoundException('Resignation not found');

    if (
      resignation.employee.reportingManagerId !== actorId &&
      !isPrivileged(actorRole)
    ) {
      throw new ForbiddenException(
        "Only this employee's manager or HR Admin can adjust the last working day",
      );
    }

    const newDate = startOfDay(new Date(dto.newDate));
    const [, updated] = await this.prisma.$transaction([
      this.prisma.lwdAdjustment.create({
        data: {
          resignationId,
          previousDate: resignation.lastWorkingDay,
          newDate,
          reason: dto.reason,
          adjustedBy: actorId,
        },
      }),
      this.prisma.resignation.update({
        where: { id: resignationId },
        data: { lastWorkingDay: newDate },
      }),
    ]);

    return updated;
  }

  getClearanceStatus(resignationId: string) {
    return this.prisma.clearanceItem.findMany({ where: { resignationId } });
  }

  // Section 7.10 Acceptance Criteria: "Offboarding IT Clearance is
  // programmatically blocked while unreturned assets exist" — the actual
  // cross-module check lives here, reading AssetsService directly rather
  // than duplicating custody logic.
  async signoffClearance(
    itemId: string,
    dto: SignoffClearanceDto,
    actorId: string,
  ) {
    const item = await this.prisma.clearanceItem.findUnique({
      where: { id: itemId },
      include: { resignation: true },
    });
    if (!item) throw new NotFoundException('Clearance item not found');
    if (item.status === ClearanceStatus.SIGNED_OFF) {
      throw new BadRequestException(
        'This clearance item is already signed off',
      );
    }

    if (item.department === ClearanceDepartment.IT) {
      const blocked = await this.assetsService.hasUnreturnedAssets(
        item.resignation.employeeId,
      );
      if (blocked) {
        throw new BadRequestException(
          'IT Clearance is blocked until every asset issued to this employee is returned or transferred',
        );
      }
    }

    const updated = await this.prisma.clearanceItem.update({
      where: { id: itemId },
      data: {
        status: ClearanceStatus.SIGNED_OFF,
        signedOffBy: actorId,
        signedOffAt: new Date(),
        remarks: dto.remarks,
      },
    });

    const remaining = await this.prisma.clearanceItem.count({
      where: {
        resignationId: item.resignationId,
        status: ClearanceStatus.PENDING,
      },
    });
    if (remaining === 0) {
      await this.prisma.resignation.update({
        where: { id: item.resignationId },
        data: { status: 'CLEARED' },
      });
    }

    return updated;
  }

  async submitExitInterview(
    resignationId: string,
    dto: SubmitExitInterviewDto,
    actorId: string,
    actorRole?: Role,
  ) {
    const resignation = await this.prisma.resignation.findUnique({
      where: { id: resignationId },
    });
    if (!resignation) throw new NotFoundException('Resignation not found');
    if (resignation.employeeId !== actorId && !isPrivileged(actorRole)) {
      throw new ForbiddenException(
        'Only the exiting employee or HR Admin can submit this exit interview',
      );
    }

    const conductedBy = isPrivileged(actorRole) ? actorId : null;
    return this.prisma.exitInterview.upsert({
      where: { resignationId },
      update: {
        responsesJson: dto.responses as Prisma.InputJsonValue,
        conductedBy,
        submittedAt: new Date(),
      },
      create: {
        resignationId,
        employeeId: resignation.employeeId,
        responsesJson: dto.responses as Prisma.InputJsonValue,
        conductedBy,
        submittedAt: new Date(),
      },
    });
  }

  // Section 7.10 Business Rule: "F&F settlement automatically pulls: unused
  // leave balance (Leave module) for encashment, unreturned/damaged asset
  // cost (Asset module), and any notice-period shortfall recovery — no
  // manual re-entry." This is that single computation.
  async computeSettlement(resignationId: string, dto: ComputeSettlementDto) {
    const resignation = await this.prisma.resignation.findUnique({
      where: { id: resignationId },
    });
    if (!resignation) throw new NotFoundException('Resignation not found');

    const year = resignation.lastWorkingDay.getUTCFullYear();
    const balances = await this.leaveService.getBalances(
      resignation.employeeId,
      year,
    );
    const encashableDays = balances
      .filter((b) => b.leaveType.isEncashable)
      .reduce((sum, b) => sum + Math.max(0, b.available), 0);
    const leaveEncashment = encashableDays * dto.perDayPayRate;

    const assetRecovery = await this.assetsService.getRecoverableAssetCost(
      resignation.employeeId,
    );

    const requiredLwd = addDays(
      startOfDay(resignation.submittedDate),
      resignation.noticePeriodDays,
    );
    const shortfallDays = Math.max(
      0,
      daysBetween(startOfDay(resignation.lastWorkingDay), requiredLwd),
    );
    const noticeRecovery = shortfallDays * dto.perDayPayRate;

    const pendingSalary = dto.pendingSalary ?? 0;
    const netPayable =
      pendingSalary + leaveEncashment - noticeRecovery - assetRecovery;

    const settlement = await this.prisma.finalSettlement.upsert({
      where: { resignationId },
      update: {
        pendingSalary,
        leaveEncashment,
        noticeRecovery,
        assetRecovery,
        netPayable,
        status: SettlementStatus.PENDING_APPROVAL,
        computedAt: new Date(),
      },
      create: {
        resignationId,
        employeeId: resignation.employeeId,
        pendingSalary,
        leaveEncashment,
        noticeRecovery,
        assetRecovery,
        netPayable,
        status: SettlementStatus.PENDING_APPROVAL,
      },
    });

    await this.notifications.send({
      recipientId: 'hr-admin',
      template: 'offboarding.settlement-computed',
      data: { resignationId, netPayable },
    });

    return settlement;
  }

  async approveSettlement(resignationId: string, actorId: string) {
    const settlement = await this.prisma.finalSettlement.findUnique({
      where: { resignationId },
    });
    if (!settlement) throw new NotFoundException('Settlement not computed yet');
    if (settlement.status !== SettlementStatus.PENDING_APPROVAL) {
      throw new BadRequestException(
        'Only a settlement pending approval can be approved',
      );
    }

    return this.prisma.finalSettlement.update({
      where: { resignationId },
      data: {
        status: SettlementStatus.APPROVED,
        approvedBy: actorId,
        approvedAt: new Date(),
      },
    });
  }

  // Section 7.10 Business Rule: "Employee status moves to 'Archived' only
  // after F&F is marked paid/settled."
  async markSettlementPaid(
    resignationId: string,
    dto: MarkSettlementPaidDto,
    actorId: string,
  ) {
    const settlement = await this.prisma.finalSettlement.findUnique({
      where: { resignationId },
    });
    if (!settlement) throw new NotFoundException('Settlement not computed yet');
    if (settlement.status !== SettlementStatus.APPROVED) {
      throw new BadRequestException(
        'The settlement must be approved before it can be marked paid',
      );
    }

    const resignation = await this.prisma.resignation.findUnique({
      where: { id: resignationId },
    });
    if (!resignation) throw new NotFoundException('Resignation not found');
    const employee = await this.prisma.employee.findUnique({
      where: { id: resignation.employeeId },
    });
    if (!employee) throw new NotFoundException('Employee not found');

    await this.prisma.$transaction([
      this.prisma.finalSettlement.update({
        where: { resignationId },
        data: { status: SettlementStatus.PAID, paidAt: new Date() },
      }),
      this.prisma.resignation.update({
        where: { id: resignationId },
        data: {
          status: 'ARCHIVED',
          rehireEligible: dto.rehireEligible ?? resignation.rehireEligible,
        },
      }),
      this.prisma.employee.update({
        where: { id: employee.id },
        data: { status: 'ARCHIVED' },
      }),
      this.prisma.employeeHistory.create({
        data: {
          employeeId: employee.id,
          fieldChanged: 'status',
          oldValue: employee.status,
          newValue: 'ARCHIVED',
          changedBy: actorId,
        },
      }),
    ]);

    return { status: 'ARCHIVED' };
  }

  // Section 7.10 Acceptance Criteria: "Relieving letter generation is
  // blocked until all clearance items are signed off."
  async generateLetters(resignationId: string) {
    const resignation = await this.prisma.resignation.findUnique({
      where: { id: resignationId },
    });
    if (!resignation) throw new NotFoundException('Resignation not found');

    const items = await this.prisma.clearanceItem.findMany({
      where: { resignationId },
    });
    const allSignedOff =
      items.length === CLEARANCE_DEPARTMENTS.length &&
      items.every((i) => i.status === ClearanceStatus.SIGNED_OFF);
    if (!allSignedOff) {
      throw new BadRequestException(
        'The relieving letter cannot be generated until all four clearance departments (IT, Finance, Admin, HR) sign off',
      );
    }

    const updated = await this.prisma.resignation.update({
      where: { id: resignationId },
      data: {
        relievingLetterRef: `relieving-letter-${resignationId}.pdf`,
        experienceLetterRef: `experience-letter-${resignationId}.pdf`,
        lettersGeneratedAt: new Date(),
      },
    });

    await this.notifications.send({
      recipientId: resignation.employeeId,
      template: 'offboarding.relieving-letter-generated',
      data: { resignationId },
    });

    return updated;
  }
}
