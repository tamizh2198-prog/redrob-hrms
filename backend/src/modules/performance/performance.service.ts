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

const WEIGHTAGE_TOLERANCE = 0.01;

function isPrivileged(role?: Role): boolean {
  return role === Role.HR_ADMIN || role === Role.SUPER_ADMIN;
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
// later is hidden by default rather than leaked.
function redactForSubject(evaluation: {
  id: string;
  employeeId: string;
  period: Date;
  kpiScore: number;
  grade: PerformanceGrade;
  auditStatus: EvaluationAuditStatus;
  createdAt: Date;
}) {
  return {
    id: evaluation.id,
    employeeId: evaluation.employeeId,
    period: evaluation.period,
    kpiScore: evaluation.kpiScore,
    kpiPercent: kpiScoreToPercent(evaluation.kpiScore),
    grade: evaluation.grade,
    auditStatus: evaluation.auditStatus,
    createdAt: evaluation.createdAt,
  };
}

function withKpiPercent<T extends { kpiScore: number }>(
  evaluation: T,
): T & { kpiPercent: number } {
  return { ...evaluation, kpiPercent: kpiScoreToPercent(evaluation.kpiScore) };
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
          data: { reviewId: r.id },
        }),
      ),
    );

    return { status: 'CLOSED', reviewsFinalized: reviews.length };
  }

  // Section 7.8 Business Rule: "further changes require a documented
  // correction workflow" once a cycle is closed.
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
    if (review.cycle.status !== ReviewCycleStatus.CLOSED) {
      throw new BadRequestException(
        'The correction workflow only applies to reviews in a closed cycle',
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

    await this.notifications.send({
      recipientId: 'hr-admin',
      template: 'performance.monthly-evaluation-submitted',
      data: { evaluationId: evaluation.id, employeeId: dto.employeeId },
    });

    return evaluation;
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
      data: { evaluationId: updated.id },
    });

    return updated;
  }

  private async assertCanViewEvaluations(
    employeeId: string,
    actorId: string,
    actorRole?: Role,
  ) {
    if (employeeId === actorId || isPrivileged(actorRole)) return;
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
