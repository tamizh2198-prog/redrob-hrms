import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  EvaluationAuditStatus,
  PerformanceGrade,
  Prisma,
  ReviewCycleStatus,
  ReviewCycleType,
  ReviewStatus,
  Role,
} from '@prisma/client';
import { PrismaService } from '../../shared/database/prisma.service';
import { DefaultCompanyService } from '../../shared/database/default-company.service';
import { NotificationService } from '../../shared/notifications/notification.service';
import {
  assertCanAccessEmployeeData,
  type EmployeeDataRequester,
} from '../../shared/employee/reporting-hierarchy.util';
import { CreateGoalDto } from './dto/create-goal.dto';
import { OpenReviewCycleDto } from './dto/open-review-cycle.dto';
import { SubmitSelfAssessmentDto } from './dto/submit-self-assessment.dto';
import { SubmitManagerAssessmentDto } from './dto/submit-manager-assessment.dto';
import { CorrectRatingDto } from './dto/correct-rating.dto';
import { SubmitMonthlyEvaluationDto } from './dto/submit-monthly-evaluation.dto';
import { AuditMonthlyEvaluationDto } from './dto/audit-monthly-evaluation.dto';
import { SubmitQuarterlyKpiDto } from './dto/submit-quarterly-kpi.dto';
import { AuditQuarterlyKpiDto } from './dto/audit-quarterly-kpi.dto';

const WEIGHTAGE_TOLERANCE = 0.01;

// Every call site of this in the file is a data-entry-on-behalf-of override
// (createGoal/updateGoalProgress/submitManagerAssessment), never an
// approve/reject decision (the audit endpoints are already SUPER_ADMIN-only
// via @Roles, and correct-rating stays HR_ADMIN/SUPER_ADMIN-only via
// @Roles), so HR_ASSOCIATE is safely included directly here.
function isPrivileged(role?: Role): boolean {
  return role === Role.HR_ADMIN || role === Role.SUPER_ADMIN || role === Role.HR_ASSOCIATE;
}

// Performance Evaluation Policy 2026, Section 4 "KPI Score Mapping".
function computeGrade(kpiScore: number): PerformanceGrade {
  if (kpiScore >= 950) return PerformanceGrade.FEE;
  if (kpiScore >= 850) return PerformanceGrade.EE;
  if (kpiScore >= 700) return PerformanceGrade.ME;
  if (kpiScore >= 600) return PerformanceGrade.PME;
  return PerformanceGrade.DNME;
}

// A KPI score is out of 1000 — the percentage is just that score on a
// 100-point scale (700 -> 70%, 857 -> 85.7% rounded to 86%).
function kpiScoreToPercent(kpiScore: number): number {
  return Math.round(kpiScore / 10);
}

// P&B effective January 2026, "3a. Member KPI Linked Rewards" — the yearly
// reward ceiling for the CTC band the employee's current ctcLpa falls into.
// Paid quarterly (yearlyLimit / 4), scaled by that quarter's average KPI%.
const KPI_REWARD_CTC_BANDS: { maxLpa: number | null; label: string; yearlyLimit: number }[] = [
  { maxLpa: 15, label: '0-15 LPA', yearlyLimit: 86400 },
  { maxLpa: 25, label: '15-25 LPA', yearlyLimit: 116600 },
  { maxLpa: 35, label: '25-35 LPA', yearlyLimit: 140000 },
  { maxLpa: null, label: '35+ LPA', yearlyLimit: 156400 },
];

function resolveKpiRewardBand(ctcLpa: number) {
  return (
    KPI_REWARD_CTC_BANDS.find((b) => b.maxLpa !== null && ctcLpa <= b.maxLpa) ??
    KPI_REWARD_CTC_BANDS[KPI_REWARD_CTC_BANDS.length - 1]
  );
}

// Quarter 1 = Jan-Mar, Quarter 2 = Apr-Jun, etc. — calendar-year quarters,
// matching the PDF's "Disbursed: July-October, January-April" language
// (i.e. paid out the month after each quarter closes, not on quarter-start).
function quarterMonthStarts(year: number, quarter: number): Date[] {
  const startMonth = (quarter - 1) * 3;
  return [0, 1, 2].map((i) => new Date(Date.UTC(year, startMonth + i, 1)));
}

function normalizeToMonthStart(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

// Monthly scores go live to the employee on the 3rd of the month *after*
// the evaluated period, regardless of when Super Admin actually approves
// it — approving late just means it's already past its release date.
function monthlyReleaseDate(period: Date): Date {
  return new Date(Date.UTC(period.getUTCFullYear(), period.getUTCMonth() + 1, 3));
}

function isMonthlyScoreVisible(evaluation: {
  auditStatus: EvaluationAuditStatus;
  period: Date;
}): boolean {
  return (
    evaluation.auditStatus === EvaluationAuditStatus.APPROVED &&
    new Date() >= monthlyReleaseDate(evaluation.period)
  );
}

// Quarterly KPI% releases the calendar day after Super Admin approves —
// unlike the monthly score, there's no fixed day-of-month; it's always
// relative to the approval itself.
function quarterlyReleaseDate(auditedAt: Date): Date {
  return new Date(
    Date.UTC(auditedAt.getUTCFullYear(), auditedAt.getUTCMonth(), auditedAt.getUTCDate() + 1),
  );
}

function isQuarterlyKpiVisible(kpi: {
  auditStatus: EvaluationAuditStatus;
  auditedAt: Date | null;
}): boolean {
  return (
    kpi.auditStatus === EvaluationAuditStatus.APPROVED &&
    kpi.auditedAt != null &&
    new Date() >= quarterlyReleaseDate(kpi.auditedAt)
  );
}

// Review Cycle cadence: Monthly = 1 month, Quarterly = 3 months (the
// existing/default behavior), Yearly = 12 months.
const REVIEW_CYCLE_MONTHS: Record<ReviewCycleType, number> = {
  [ReviewCycleType.MONTHLY]: 1,
  [ReviewCycleType.QUARTERLY]: 3,
  [ReviewCycleType.YEARLY]: 12,
};

// Only used to fill in a period end the caller didn't supply — mirrors the
// UTC-based date math already used elsewhere in this service/the Leave
// module rather than pulling in a date library for one calculation.
function addMonthsUtc(date: Date, months: number): Date {
  const result = new Date(date);
  result.setUTCMonth(result.getUTCMonth() + months);
  return result;
}

// Product decision (overrides the literal policy wording, which says exact
// scores are never shared with employees): the employee dashboard shows the
// score and grade, but never the manager's justification or who submitted
// it — an allow-list, not a deny-list, so a new confidential field added
// later is hidden by default rather than leaked. Additionally gated on
// isMonthlyScoreVisible: an approved-but-not-yet-released score is hidden
// from the subject the same as an unapproved one — releaseDate is always
// included so the UI can say when it'll show up.
function redactForSubject(evaluation: {
  id: string;
  employeeId: string;
  period: Date;
  kpiScore: number;
  grade: PerformanceGrade;
  auditStatus: EvaluationAuditStatus;
  createdAt: Date;
}) {
  const visible = isMonthlyScoreVisible(evaluation);
  return {
    id: evaluation.id,
    employeeId: evaluation.employeeId,
    period: evaluation.period,
    kpiScore: visible ? evaluation.kpiScore : null,
    kpiPercent: visible ? kpiScoreToPercent(evaluation.kpiScore) : null,
    grade: visible ? evaluation.grade : null,
    auditStatus: evaluation.auditStatus,
    releaseDate: monthlyReleaseDate(evaluation.period),
    createdAt: evaluation.createdAt,
  };
}

function withKpiPercent<T extends { kpiScore: number }>(
  evaluation: T,
): T & { kpiPercent: number } {
  return { ...evaluation, kpiPercent: kpiScoreToPercent(evaluation.kpiScore) };
}

// Same confidentiality contract as redactForSubject, for the new quarterly
// KPI%: hidden from the subject until approved AND past its release date.
// releaseDate is only knowable once Super Admin has actually approved it
// (it's relative to auditedAt, not a fixed calendar day), so it's null
// until then.
function redactQuarterlyKpiForSubject(kpi: {
  id: string;
  employeeId: string;
  year: number;
  quarter: number;
  kpiPercent: number;
  auditStatus: EvaluationAuditStatus;
  auditedAt: Date | null;
  createdAt: Date;
}) {
  const visible = isQuarterlyKpiVisible(kpi);
  return {
    id: kpi.id,
    employeeId: kpi.employeeId,
    year: kpi.year,
    quarter: kpi.quarter,
    kpiPercent: visible ? kpi.kpiPercent : null,
    auditStatus: kpi.auditStatus,
    releaseDate: kpi.auditedAt ? quarterlyReleaseDate(kpi.auditedAt) : null,
    createdAt: kpi.createdAt,
  };
}

// Submission order (self vs manager) never matters — status is always
// re-derived from which sections are actually present.
function deriveReviewStatus(review: {
  selfAssessmentJson: unknown;
  managerAssessmentJson: unknown;
}): ReviewStatus {
  const hasSelf = review.selfAssessmentJson != null;
  const hasManager = review.managerAssessmentJson != null;
  if (hasSelf && hasManager) return ReviewStatus.READY_FOR_CALIBRATION;
  if (hasSelf || hasManager) return ReviewStatus.IN_PROGRESS;
  return ReviewStatus.NOT_STARTED;
}

@Injectable()
export class PerformanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly defaultCompany: DefaultCompanyService,
    private readonly notifications: NotificationService,
  ) {}

  async openReviewCycle(dto: OpenReviewCycleDto) {
    const companyId =
      dto.companyId ?? (await this.defaultCompany.getOrCreate());
    // Preserves current behavior for every existing caller: omitting
    // cycleType still creates a Quarterly cycle, and an explicit periodEnd
    // is always honored as-is rather than overridden by the cadence math.
    const cycleType = dto.cycleType ?? ReviewCycleType.QUARTERLY;
    const periodStart = new Date(dto.periodStart);
    const periodEnd = dto.periodEnd
      ? new Date(dto.periodEnd)
      : addMonthsUtc(periodStart, REVIEW_CYCLE_MONTHS[cycleType]);
    const cycle = await this.prisma.reviewCycle.create({
      data: {
        companyId,
        name: dto.name,
        cycleType,
        periodStart,
        periodEnd,
      },
    });

    const participants = await this.prisma.employee.findMany({
      where: {
        companyId,
        status: { in: ['ACTIVE', 'ACTIVE_PROBATION'] },
      },
      select: { id: true },
    });
    await Promise.all(
      participants.map((p) =>
        this.notifications.send({
          recipientId: p.id,
          template: 'performance.cycle-opened',
          body: `The "${cycle.name}" review cycle is now open. Please set your goals.`,
          data: { cycleId: cycle.id },
        }),
      ),
    );

    return cycle;
  }

  listReviewCycles() {
    return this.prisma.reviewCycle.findMany({ orderBy: { createdAt: 'desc' } });
  }

  private async getOpenCycle(cycleId: string) {
    const cycle = await this.prisma.reviewCycle.findUnique({
      where: { id: cycleId },
    });
    if (!cycle) throw new NotFoundException('Review cycle not found');
    return cycle;
  }

  async createGoal(dto: CreateGoalDto, actorId: string, actorRole?: Role) {
    const employeeId = dto.employeeId ?? actorId;
    if (employeeId !== actorId && !isPrivileged(actorRole)) {
      const target = await this.prisma.employee.findUnique({
        where: { id: employeeId },
      });
      if (
        actorRole !== Role.MANAGER ||
        target?.reportingManagerId !== actorId
      ) {
        throw new ForbiddenException(
          'Only the employee, their manager, or HR Admin can set this goal',
        );
      }
    }

    const cycle = await this.getOpenCycle(dto.cycleId);
    if (cycle.status === ReviewCycleStatus.CLOSED) {
      throw new BadRequestException('This review cycle is closed');
    }

    return this.prisma.goal.create({
      data: {
        employeeId,
        cycleId: dto.cycleId,
        parentGoalId: dto.parentGoalId,
        title: dto.title,
        target: dto.target,
        weightage: dto.weightage,
      },
    });
  }

  async listGoals(
    employeeId: string,
    cycleId: string | undefined,
    requester: EmployeeDataRequester,
  ) {
    await assertCanAccessEmployeeData(this.prisma, employeeId, requester);
    return this.prisma.goal.findMany({
      where: { employeeId, cycleId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async updateGoalProgress(
    goalId: string,
    actual: number,
    actorId: string,
    actorRole?: Role,
  ) {
    const goal = await this.prisma.goal.findUnique({ where: { id: goalId } });
    if (!goal) throw new NotFoundException('Goal not found');

    if (goal.employeeId !== actorId && !isPrivileged(actorRole)) {
      const target = await this.prisma.employee.findUnique({
        where: { id: goal.employeeId },
      });
      if (
        actorRole !== Role.MANAGER ||
        target?.reportingManagerId !== actorId
      ) {
        throw new ForbiddenException(
          'Only the employee, their manager, or HR Admin can update this goal',
        );
      }
    }

    return this.prisma.goal.update({
      where: { id: goalId },
      data: { actual },
    });
  }

  private async getOrCreateReview(cycleId: string, employeeId: string) {
    const existing = await this.prisma.review.findUnique({
      where: { cycleId_employeeId: { cycleId, employeeId } },
    });
    if (existing) return existing;
    return this.prisma.review.create({ data: { cycleId, employeeId } });
  }

  async getReview(
    cycleId: string,
    employeeId: string,
    requester: EmployeeDataRequester,
  ) {
    await assertCanAccessEmployeeData(this.prisma, employeeId, requester);
    return this.prisma.review.findUnique({
      where: { cycleId_employeeId: { cycleId, employeeId } },
      include: { corrections: true },
    });
  }

  // Section 7.8 Acceptance Criteria: "Goal weightage validation blocks
  // submission if it doesn't sum to 100%."
  private async assertWeightageComplete(cycleId: string, employeeId: string) {
    const goals = await this.prisma.goal.findMany({
      where: { cycleId, employeeId },
    });
    const total = goals.reduce((sum, g) => sum + g.weightage, 0);
    if (Math.abs(total - 100) > WEIGHTAGE_TOLERANCE) {
      throw new BadRequestException(
        `Goal weightages must sum to 100% before submitting (currently ${total}%)`,
      );
    }
  }

  async submitSelfAssessment(dto: SubmitSelfAssessmentDto, actorId: string) {
    const cycle = await this.getOpenCycle(dto.cycleId);
    if (cycle.status === ReviewCycleStatus.CLOSED) {
      throw new BadRequestException(
        'This cycle is closed — ratings are locked; use the correction workflow instead',
      );
    }
    await this.assertWeightageComplete(dto.cycleId, actorId);

    const review = await this.getOrCreateReview(dto.cycleId, actorId);
    if (review.status === ReviewStatus.FINALIZED) {
      throw new BadRequestException(
        'This review is finalized; use the correction workflow instead',
      );
    }

    const updated = await this.prisma.review.update({
      where: { id: review.id },
      data: {
        selfAssessmentJson: dto.assessment as Prisma.InputJsonValue,
        status: deriveReviewStatus({
          selfAssessmentJson: dto.assessment,
          managerAssessmentJson: review.managerAssessmentJson,
        }),
      },
    });

    const employee = await this.prisma.employee.findUnique({
      where: { id: actorId },
    });
    if (employee?.reportingManagerId) {
      await this.notifications.send({
        recipientId: employee.reportingManagerId,
        template: 'performance.self-assessment-submitted',
        body: `${employee.firstName} ${employee.lastName} submitted their self-assessment and it's awaiting your review.`,
        data: { reviewId: updated.id },
      });
    }

    return updated;
  }

  async submitManagerAssessment(
    dto: SubmitManagerAssessmentDto,
    actorId: string,
    actorRole?: Role,
  ) {
    const employee = await this.prisma.employee.findUnique({
      where: { id: dto.employeeId },
    });
    if (!employee) throw new NotFoundException('Employee not found');
    if (employee.reportingManagerId !== actorId && !isPrivileged(actorRole)) {
      throw new ForbiddenException(
        "Only this employee's manager or HR Admin can submit this assessment",
      );
    }

    const cycle = await this.getOpenCycle(dto.cycleId);
    if (cycle.status === ReviewCycleStatus.CLOSED) {
      throw new BadRequestException(
        'This cycle is closed — ratings are locked; use the correction workflow instead',
      );
    }

    const review = await this.getOrCreateReview(dto.cycleId, dto.employeeId);
    if (review.status === ReviewStatus.FINALIZED) {
      throw new BadRequestException(
        'This review is finalized; use the correction workflow instead',
      );
    }
    // A manager's score locks the moment it's first given — not just at
    // cycle close — so it can't be silently re-edited. Any change from here
    // on must go through the audited correction workflow instead.
    if (review.managerAssessmentJson != null) {
      throw new BadRequestException(
        'A manager assessment was already submitted for this review; use the correction workflow instead',
      );
    }

    const updated = await this.prisma.review.update({
      where: { id: review.id },
      data: {
        managerAssessmentJson: dto.assessment as Prisma.InputJsonValue,
        finalRating: dto.rating,
        status: deriveReviewStatus({
          selfAssessmentJson: review.selfAssessmentJson,
          managerAssessmentJson: dto.assessment,
        }),
      },
    });

    return updated;
  }

  // Section 7.8 Acceptance Criteria: "A review cannot close without both
  // self and manager sections submitted." — enforced per-employee at the
  // point the whole cycle is closed, matching the PRD workflow ("HR Admin
  // calibration → Cycle closed and shared with employee").
  async closeReviewCycle(cycleId: string, actorId: string) {
    const cycle = await this.getOpenCycle(cycleId);
    if (cycle.status === ReviewCycleStatus.CLOSED) {
      throw new BadRequestException('This cycle is already closed');
    }

    const reviews = await this.prisma.review.findMany({
      where: { cycleId },
    });
    const incomplete = reviews.filter(
      (r) => r.selfAssessmentJson == null || r.managerAssessmentJson == null,
    );
    if (incomplete.length > 0) {
      throw new BadRequestException(
        `${incomplete.length} review(s) are missing a self or manager assessment and cannot be finalized`,
      );
    }

    const now = new Date();
    await this.prisma.$transaction([
      ...reviews.map((r) =>
        this.prisma.review.update({
          where: { id: r.id },
          data: {
            status: ReviewStatus.FINALIZED,
            finalizedBy: actorId,
            finalizedAt: now,
          },
        }),
      ),
      this.prisma.reviewCycle.update({
        where: { id: cycleId },
        data: {
          status: ReviewCycleStatus.CLOSED,
          closedBy: actorId,
          closedAt: now,
        },
      }),
    ]);

    await Promise.all(
      reviews.map((r) =>
        this.notifications.send({
          recipientId: r.employeeId,
          template: 'performance.review-finalized',
          body: `Your review for the "${cycle.name}" cycle has been finalized.`,
          data: { reviewId: r.id },
        }),
      ),
    );

    return { status: 'CLOSED', reviewsFinalized: reviews.length };
  }

  // Section 7.8 Business Rule: "further changes require a documented
  // correction workflow." A score locks the instant a manager first submits
  // it (see submitManagerAssessment), not just at cycle close — so this
  // workflow must be usable from that moment on, otherwise a genuine mistake
  // would be uncorrectable by anyone (including HR) until the cycle closes.
  async correctRating(
    reviewId: string,
    dto: CorrectRatingDto,
    actorId: string,
  ) {
    const review = await this.prisma.review.findUnique({
      where: { id: reviewId },
      include: { cycle: true },
    });
    if (!review) throw new NotFoundException('Review not found');
    if (review.managerAssessmentJson == null) {
      throw new BadRequestException(
        'There is no submitted manager assessment on this review to correct yet',
      );
    }

    const [, updated] = await this.prisma.$transaction([
      this.prisma.reviewCorrection.create({
        data: {
          reviewId,
          previousRating: review.finalRating,
          newRating: dto.newRating,
          reason: dto.reason,
          correctedBy: actorId,
        },
      }),
      this.prisma.review.update({
        where: { id: reviewId },
        data: {
          finalRating: dto.newRating,
          version: { increment: 1 },
        },
      }),
    ]);

    return updated;
  }

  // Section 7.8 Key Feature: "Calibration view for HR Admin to compare
  // rating distributions across managers/departments before finalizing."
  async getCalibrationView(cycleId: string) {
    const reviews = await this.prisma.review.findMany({
      where: { cycleId, finalRating: { not: null } },
      include: {
        employee: { select: { departmentId: true, reportingManagerId: true } },
      },
    });

    const byDepartment: Record<string, number[]> = {};
    const byManager: Record<string, number[]> = {};
    for (const r of reviews) {
      const dept = r.employee.departmentId ?? 'unassigned';
      const mgr = r.employee.reportingManagerId ?? 'unassigned';
      (byDepartment[dept] ??= []).push(r.finalRating!);
      (byManager[mgr] ??= []).push(r.finalRating!);
    }

    const avg = (nums: number[]) =>
      nums.reduce((a, b) => a + b, 0) / nums.length;

    return {
      totalRated: reviews.length,
      byDepartment: Object.fromEntries(
        Object.entries(byDepartment).map(([k, v]) => [
          k,
          { count: v.length, average: avg(v) },
        ]),
      ),
      byManager: Object.fromEntries(
        Object.entries(byManager).map(([k, v]) => [
          k,
          { count: v.length, average: avg(v) },
        ]),
      ),
    };
  }

  // Policy Section 2 "KPI Scoring and Governance": manager submits, HR/
  // finance-compliance audits before it counts as final. Re-submitting for
  // the same employee+period (e.g. after a send-back) overwrites the prior
  // score and resets it to pending audit; once APPROVED it's locked, since
  // the policy defines no correction workflow for monthly scores.
  // Product decision: scoring is restricted to the employee's assigned
  // manager specifically — unlike every other "manager or HR" check in this
  // module, HR/Super Admin cannot submit a score on a manager's behalf.
  async submitMonthlyEvaluation(
    dto: SubmitMonthlyEvaluationDto,
    actorId: string,
  ) {
    const employee = await this.prisma.employee.findUnique({
      where: { id: dto.employeeId },
    });
    if (!employee) throw new NotFoundException('Employee not found');
    if (employee.reportingManagerId !== actorId) {
      throw new ForbiddenException(
        "Only this employee's assigned manager can submit a monthly evaluation",
      );
    }

    const period = normalizeToMonthStart(new Date(dto.period));
    const existing = await this.prisma.monthlyEvaluation.findUnique({
      where: { employeeId_period: { employeeId: dto.employeeId, period } },
    });
    if (existing?.auditStatus === EvaluationAuditStatus.APPROVED) {
      throw new BadRequestException(
        'This month has already been audited and approved; it cannot be resubmitted',
      );
    }

    const grade = computeGrade(dto.kpiScore);
    const evaluation = await this.prisma.monthlyEvaluation.upsert({
      where: { employeeId_period: { employeeId: dto.employeeId, period } },
      update: {
        kpiScore: dto.kpiScore,
        grade,
        justification: dto.justification,
        submittedBy: actorId,
        submittedAt: new Date(),
        auditStatus: EvaluationAuditStatus.PENDING_AUDIT,
        auditedBy: null,
        auditedAt: null,
        auditNotes: null,
        releaseNotifiedAt: null,
      },
      create: {
        employeeId: dto.employeeId,
        period,
        kpiScore: dto.kpiScore,
        grade,
        justification: dto.justification,
        submittedBy: actorId,
      },
    });

    const superAdminIds = await this.listSuperAdminIds();
    await Promise.all(
      superAdminIds.map((id) =>
        this.notifications.send({
          recipientId: id,
          template: 'performance.monthly-evaluation-submitted',
          body: `A monthly evaluation for employee ${dto.employeeId} (period ${period.toISOString().slice(0, 10)}, grade ${grade}) was submitted and is awaiting audit.`,
          data: { evaluationId: evaluation.id, employeeId: dto.employeeId },
        }),
      ),
    );

    return evaluation;
  }

  // Only SUPER_ADMIN can audit either monthly scores or quarterly KPIs in
  // this module (an established, explicit product decision — HR_ADMIN has
  // no audit role here), so this is the actual notification audience for
  // both submit flows.
  private async listSuperAdminIds(): Promise<string[]> {
    const admins = await this.prisma.employee.findMany({
      where: { role: Role.SUPER_ADMIN },
      select: { id: true },
    });
    return admins.map((a) => a.id);
  }

  // Section 2: "Scores may be sent back for clarification or validation
  // where required" — auditNotes is required in that case since there's
  // nothing else pointing the manager at what to fix.
  async auditMonthlyEvaluation(
    evaluationId: string,
    dto: AuditMonthlyEvaluationDto,
    actorId: string,
  ) {
    const evaluation = await this.prisma.monthlyEvaluation.findUnique({
      where: { id: evaluationId },
    });
    if (!evaluation)
      throw new NotFoundException('Monthly evaluation not found');
    if (evaluation.auditStatus !== EvaluationAuditStatus.PENDING_AUDIT) {
      throw new BadRequestException('This evaluation is not pending audit');
    }
    if (!dto.approve && !dto.auditNotes) {
      throw new BadRequestException(
        'auditNotes is required when sending an evaluation back for clarification',
      );
    }

    const updated = await this.prisma.monthlyEvaluation.update({
      where: { id: evaluationId },
      data: {
        auditStatus: dto.approve
          ? EvaluationAuditStatus.APPROVED
          : EvaluationAuditStatus.SENT_BACK,
        auditedBy: actorId,
        auditedAt: new Date(),
        auditNotes: dto.auditNotes ?? null,
      },
    });

    await this.notifications.send({
      recipientId: updated.submittedBy,
      template: dto.approve
        ? 'performance.monthly-evaluation-approved'
        : 'performance.monthly-evaluation-sent-back',
      body: dto.approve
        ? `The monthly evaluation you submitted for ${updated.period.toISOString().slice(0, 10)} was approved.`
        : `The monthly evaluation you submitted for ${updated.period.toISOString().slice(0, 10)} was sent back for clarification.${dto.auditNotes ? ` Comment: "${dto.auditNotes}"` : ''}`,
      data: { evaluationId: updated.id },
    });

    return updated;
  }

  // Standalone quarterly KPI percentage — distinct from both the monthly
  // KPI score above and the auto-computed quarterly reward derived from it
  // (computeQuarterlyKpiReward, below). Same restriction as
  // submitMonthlyEvaluation: only the employee's actual assigned manager,
  // never HR/Super Admin on their behalf.
  async submitQuarterlyKpi(dto: SubmitQuarterlyKpiDto, actorId: string) {
    const employee = await this.prisma.employee.findUnique({
      where: { id: dto.employeeId },
    });
    if (!employee) throw new NotFoundException('Employee not found');
    if (employee.reportingManagerId !== actorId) {
      throw new ForbiddenException(
        "Only this employee's assigned manager can submit a quarterly KPI",
      );
    }

    const existing = await this.prisma.quarterlyKpi.findUnique({
      where: {
        employeeId_year_quarter: {
          employeeId: dto.employeeId,
          year: dto.year,
          quarter: dto.quarter,
        },
      },
    });
    if (existing?.auditStatus === EvaluationAuditStatus.APPROVED) {
      throw new BadRequestException(
        'This quarter has already been audited and approved; it cannot be resubmitted',
      );
    }

    const kpi = await this.prisma.quarterlyKpi.upsert({
      where: {
        employeeId_year_quarter: {
          employeeId: dto.employeeId,
          year: dto.year,
          quarter: dto.quarter,
        },
      },
      update: {
        kpiPercent: dto.kpiPercent,
        justification: dto.justification,
        submittedBy: actorId,
        submittedAt: new Date(),
        auditStatus: EvaluationAuditStatus.PENDING_AUDIT,
        auditedBy: null,
        auditedAt: null,
        auditNotes: null,
        releaseNotifiedAt: null,
      },
      create: {
        employeeId: dto.employeeId,
        year: dto.year,
        quarter: dto.quarter,
        kpiPercent: dto.kpiPercent,
        justification: dto.justification,
        submittedBy: actorId,
      },
    });

    const superAdminIds = await this.listSuperAdminIds();
    await Promise.all(
      superAdminIds.map((id) =>
        this.notifications.send({
          recipientId: id,
          template: 'performance.quarterly-kpi-submitted',
          body: `A Q${dto.quarter} ${dto.year} KPI (${dto.kpiPercent}%) for employee ${dto.employeeId} was submitted and is awaiting audit.`,
          data: { kpiId: kpi.id, employeeId: dto.employeeId },
        }),
      ),
    );

    return kpi;
  }

  async auditQuarterlyKpi(
    id: string,
    dto: AuditQuarterlyKpiDto,
    actorId: string,
  ) {
    const kpi = await this.prisma.quarterlyKpi.findUnique({ where: { id } });
    if (!kpi) throw new NotFoundException('Quarterly KPI not found');
    if (kpi.auditStatus !== EvaluationAuditStatus.PENDING_AUDIT) {
      throw new BadRequestException('This KPI is not pending audit');
    }
    if (!dto.approve && !dto.auditNotes) {
      throw new BadRequestException(
        'auditNotes is required when sending a KPI back for clarification',
      );
    }

    const updated = await this.prisma.quarterlyKpi.update({
      where: { id },
      data: {
        auditStatus: dto.approve
          ? EvaluationAuditStatus.APPROVED
          : EvaluationAuditStatus.SENT_BACK,
        auditedBy: actorId,
        auditedAt: new Date(),
        auditNotes: dto.auditNotes ?? null,
      },
    });

    await this.notifications.send({
      recipientId: updated.submittedBy,
      template: dto.approve
        ? 'performance.quarterly-kpi-approved'
        : 'performance.quarterly-kpi-sent-back',
      body: dto.approve
        ? `The Q${updated.quarter} ${updated.year} KPI you submitted was approved.`
        : `The Q${updated.quarter} ${updated.year} KPI you submitted was sent back for clarification.${dto.auditNotes ? ` Comment: "${dto.auditNotes}"` : ''}`,
      data: { kpiId: updated.id },
    });

    return updated;
  }

  async listQuarterlyKpis(
    employeeId: string,
    actorId: string,
    actorRole?: Role,
  ) {
    await this.assertCanViewEvaluations(employeeId, actorId, actorRole);
    const kpis = await this.prisma.quarterlyKpi.findMany({
      where: { employeeId },
      orderBy: [{ year: 'desc' }, { quarter: 'desc' }],
    });
    return employeeId === actorId
      ? kpis.map(redactQuarterlyKpiForSubject)
      : kpis;
  }

  async getQuarterlyKpi(id: string, actorId: string, actorRole?: Role) {
    const kpi = await this.prisma.quarterlyKpi.findUnique({ where: { id } });
    if (!kpi) throw new NotFoundException('Quarterly KPI not found');
    await this.assertCanViewEvaluations(kpi.employeeId, actorId, actorRole);
    return kpi.employeeId === actorId
      ? redactQuarterlyKpiForSubject(kpi)
      : kpi;
  }

  // Orchestration for PerformanceKpiReleaseService's daily cron — the "what's
  // due" query lives here (same split as AnalyticsReportSchedulerService /
  // WorkflowEscalationService), filtered to APPROVED-and-not-yet-notified
  // rows first in SQL, then to those actually past their release date.
  async findDueMonthlyReleases() {
    const now = new Date();
    const candidates = await this.prisma.monthlyEvaluation.findMany({
      where: { auditStatus: EvaluationAuditStatus.APPROVED, releaseNotifiedAt: null },
    });
    return candidates.filter((e) => now >= monthlyReleaseDate(e.period));
  }

  async markMonthlyReleaseNotified(id: string) {
    await this.prisma.monthlyEvaluation.update({
      where: { id },
      data: { releaseNotifiedAt: new Date() },
    });
  }

  async findDueQuarterlyKpiReleases() {
    const now = new Date();
    const candidates = await this.prisma.quarterlyKpi.findMany({
      where: {
        auditStatus: EvaluationAuditStatus.APPROVED,
        releaseNotifiedAt: null,
        auditedAt: { not: null },
      },
    });
    return candidates.filter((k) => k.auditedAt && now >= quarterlyReleaseDate(k.auditedAt));
  }

  async markQuarterlyKpiReleaseNotified(id: string) {
    await this.prisma.quarterlyKpi.update({
      where: { id },
      data: { releaseNotifiedAt: new Date() },
    });
  }

  // Product decision: unlike goals/reviews (isPrivileged — HR_ADMIN or
  // SUPER_ADMIN), monthly KPI evaluations can be browsed/audited across the
  // whole company by SUPER_ADMIN only. HR_ADMIN keeps exactly the same
  // access as everyone else here — self, or an employee who actually
  // reports to them.
  private async assertCanViewEvaluations(
    employeeId: string,
    actorId: string,
    actorRole?: Role,
  ) {
    if (employeeId === actorId || actorRole === Role.SUPER_ADMIN) return;
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
    });
    if (employee?.reportingManagerId === actorId) return;
    throw new ForbiddenException(
      "Not authorized to view this employee's evaluations",
    );
  }

  async listMonthlyEvaluations(
    employeeId: string,
    actorId: string,
    actorRole?: Role,
  ) {
    await this.assertCanViewEvaluations(employeeId, actorId, actorRole);
    const evaluations = await this.prisma.monthlyEvaluation.findMany({
      where: { employeeId },
      orderBy: { period: 'desc' },
    });
    return employeeId === actorId
      ? evaluations.map(redactForSubject)
      : evaluations.map(withKpiPercent);
  }

  async getMonthlyEvaluation(id: string, actorId: string, actorRole?: Role) {
    const evaluation = await this.prisma.monthlyEvaluation.findUnique({
      where: { id },
    });
    if (!evaluation)
      throw new NotFoundException('Monthly evaluation not found');
    await this.assertCanViewEvaluations(
      evaluation.employeeId,
      actorId,
      actorRole,
    );
    return evaluation.employeeId === actorId
      ? redactForSubject(evaluation)
      : withKpiPercent(evaluation);
  }

  // Performance Evaluation Policy 2026 Section 6 "Incentives & Recognition"
  // + P&B "3a. Member KPI Linked Rewards": one quarter's payout, computed
  // fresh from whatever's currently APPROVED rather than persisted anywhere
  // — it can only ever move in step with the audited monthly scores it's
  // built from, never drift out of sync with a correction made after the
  // fact.
  private async computeQuarterlyKpiReward(
    employeeId: string,
    ctcLpa: number | null,
    year: number,
    quarter: number,
  ) {
    const periods = quarterMonthStarts(year, quarter);
    const evaluations = await this.prisma.monthlyEvaluation.findMany({
      where: { employeeId, period: { in: periods } },
    });
    const byPeriod = new Map(evaluations.map((e) => [e.period.getTime(), e]));

    const months = periods.map((period) => {
      const evaluation = byPeriod.get(period.getTime());
      const approved = evaluation?.auditStatus === EvaluationAuditStatus.APPROVED;
      return {
        period,
        kpiScore: approved ? evaluation!.kpiScore : null,
        kpiPercent: approved ? kpiScoreToPercent(evaluation!.kpiScore) : null,
        auditStatus: evaluation?.auditStatus ?? null,
      };
    });

    const allApproved = months.every((m) => m.kpiScore !== null);
    const band = ctcLpa != null ? resolveKpiRewardBand(ctcLpa) : null;
    const quarterlyLimit = band ? band.yearlyLimit / 4 : null;

    if (!allApproved || !band) {
      return {
        employeeId,
        year,
        quarter,
        months,
        avgKpiPercent: null,
        ctcBandLabel: band?.label ?? null,
        yearlyLimit: band?.yearlyLimit ?? null,
        quarterlyLimit,
        rewardAmount: null,
        complete: false,
        reason:
          ctcLpa == null
            ? 'CTC is not set for this employee yet'
            : 'Not all three months of this quarter have an approved evaluation yet',
      };
    }

    // Average the raw scores once, then convert to a percentage — averaging
    // three already-rounded percentages compounds rounding error for no
    // reason.
    const avgKpiScore =
      months.reduce((sum, m) => sum + (m.kpiScore ?? 0), 0) / months.length;
    const avgKpiPercent = kpiScoreToPercent(avgKpiScore);
    const rewardAmount = Math.round((quarterlyLimit as number) * (avgKpiPercent / 100));

    return {
      employeeId,
      year,
      quarter,
      months,
      avgKpiPercent,
      ctcBandLabel: band.label,
      yearlyLimit: band.yearlyLimit,
      quarterlyLimit,
      rewardAmount,
      complete: true,
      reason: null,
    };
  }

  // One year's worth of quarters at once — the shape the Performance page's
  // rewards panel actually wants, rather than four round trips.
  async listQuarterlyKpiRewards(
    employeeId: string,
    year: number,
    actorId: string,
    actorRole?: Role,
  ) {
    await this.assertCanViewEvaluations(employeeId, actorId, actorRole);
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
    });
    if (!employee) throw new NotFoundException('Employee not found');

    const quarters = await Promise.all(
      [1, 2, 3, 4].map((q) =>
        this.computeQuarterlyKpiReward(employeeId, employee.ctcLpa, year, q),
      ),
    );
    return { employeeId, year, ctcLpa: employee.ctcLpa, quarters };
  }
}
