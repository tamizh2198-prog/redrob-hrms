import type { PrismaClient, Prisma, Role } from "@prisma/client";
import { EvaluationAuditStatus, PerformanceGrade, ReviewCycleStatus, ReviewCycleType, ReviewStatus } from "@prisma/client";
import { getOrCreateDefaultCompanyId } from "../../lib/default-company";
import { notify } from "../../lib/notify";
import { assertCanAccessEmployeeData, type EmployeeDataRequester } from "../../lib/reporting-hierarchy";
import { BadRequestError, ForbiddenError, NotFoundError } from "../../lib/errors";
import type {
  AuditMonthlyEvaluationDto,
  CreateGoalDto,
  OpenReviewCycleDto,
  SubmitManagerAssessmentDto,
  SubmitMonthlyEvaluationDto,
  SubmitSelfAssessmentDto,
} from "./dto";

const WEIGHTAGE_TOLERANCE = 0.01;

// Every call site of this in the file is a data-entry-on-behalf-of override
// (createGoal/updateGoalProgress/submitManagerAssessment), never an
// approve/reject decision (the audit endpoint is already SUPER_ADMIN-only),
// so HR_ASSOCIATE is safely included directly here.
function isPrivileged(role?: Role): boolean {
  return role === "HR_ADMIN" || role === "SUPER_ADMIN" || role === "HR_ASSOCIATE";
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

function normalizeToMonthStart(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

// Monthly scores go live to the employee on the 3rd of the month *after*
// the evaluated period, regardless of when Super Admin actually approves it
// — approving late just means it's already past its release date.
function monthlyReleaseDate(period: Date): Date {
  return new Date(Date.UTC(period.getUTCFullYear(), period.getUTCMonth() + 1, 3));
}

function isMonthlyScoreVisible(evaluation: { auditStatus: EvaluationAuditStatus; period: Date }): boolean {
  return evaluation.auditStatus === EvaluationAuditStatus.APPROVED && new Date() >= monthlyReleaseDate(evaluation.period);
}

// Review Cycle cadence: Monthly = 1 month, Quarterly = 3 months (the
// existing/default behavior), Yearly = 12 months.
const REVIEW_CYCLE_MONTHS: Record<ReviewCycleType, number> = {
  [ReviewCycleType.MONTHLY]: 1,
  [ReviewCycleType.QUARTERLY]: 3,
  [ReviewCycleType.YEARLY]: 12,
};

// Only used to fill in a period end the caller didn't supply — mirrors the
// UTC-based date math already used elsewhere rather than pulling in a date
// library for one calculation.
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

function withKpiPercent<T extends { kpiScore: number }>(evaluation: T): T & { kpiPercent: number } {
  return { ...evaluation, kpiPercent: kpiScoreToPercent(evaluation.kpiScore) };
}

// Submission order (self vs manager) never matters — status is always
// re-derived from which sections are actually present.
function deriveReviewStatus(review: { selfAssessmentJson: unknown; managerAssessmentJson: unknown }): ReviewStatus {
  const hasSelf = review.selfAssessmentJson != null;
  const hasManager = review.managerAssessmentJson != null;
  if (hasSelf && hasManager) return ReviewStatus.READY_FOR_CALIBRATION;
  if (hasSelf || hasManager) return ReviewStatus.IN_PROGRESS;
  return ReviewStatus.NOT_STARTED;
}

export async function openReviewCycle(prisma: PrismaClient, dto: OpenReviewCycleDto) {
  const companyId = dto.companyId ?? (await getOrCreateDefaultCompanyId(prisma));
  // Preserves current behavior for every existing caller: omitting
  // cycleType still creates a Quarterly cycle, and an explicit periodEnd is
  // always honored as-is rather than overridden by the cadence math.
  const cycleType = dto.cycleType ?? ReviewCycleType.QUARTERLY;
  const periodStart = new Date(dto.periodStart);
  const periodEnd = dto.periodEnd ? new Date(dto.periodEnd) : addMonthsUtc(periodStart, REVIEW_CYCLE_MONTHS[cycleType]);
  const cycle = await prisma.reviewCycle.create({
    data: { companyId, name: dto.name, cycleType, periodStart, periodEnd },
  });

  const participants = await prisma.employee.findMany({
    where: { companyId, status: { in: ["ACTIVE", "ACTIVE_PROBATION"] } },
    select: { id: true },
  });
  await Promise.all(
    participants.map((p) =>
      notify(prisma, {
        recipientId: p.id,
        template: "performance.cycle-opened",
        body: `The "${cycle.name}" review cycle is now open. Please set your goals.`,
        data: { cycleId: cycle.id },
      }),
    ),
  );

  return cycle;
}

export function listReviewCycles(prisma: PrismaClient) {
  return prisma.reviewCycle.findMany({ orderBy: { createdAt: "desc" } });
}

async function getOpenCycle(prisma: PrismaClient, cycleId: string) {
  const cycle = await prisma.reviewCycle.findUnique({ where: { id: cycleId } });
  if (!cycle) throw new NotFoundError("Review cycle not found");
  return cycle;
}

export async function createGoal(prisma: PrismaClient, dto: CreateGoalDto, actorId: string, actorRole?: Role) {
  const employeeId = dto.employeeId ?? actorId;
  if (employeeId !== actorId && !isPrivileged(actorRole)) {
    const target = await prisma.employee.findUnique({ where: { id: employeeId } });
    if (actorRole !== "MANAGER" || target?.reportingManagerId !== actorId) {
      throw new ForbiddenError("Only the employee, their manager, or HR Admin can set this goal");
    }
  }

  const cycle = await getOpenCycle(prisma, dto.cycleId);
  if (cycle.status === ReviewCycleStatus.CLOSED) {
    throw new BadRequestError("This review cycle is closed");
  }

  return prisma.goal.create({
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

export async function listGoals(
  prisma: PrismaClient,
  employeeId: string,
  cycleId: string | undefined,
  requester: EmployeeDataRequester,
) {
  await assertCanAccessEmployeeData(prisma, employeeId, requester);
  return prisma.goal.findMany({
    where: { employeeId, cycleId },
    orderBy: { createdAt: "asc" },
  });
}

export async function updateGoalProgress(prisma: PrismaClient, goalId: string, actual: number, actorId: string, actorRole?: Role) {
  const goal = await prisma.goal.findUnique({ where: { id: goalId } });
  if (!goal) throw new NotFoundError("Goal not found");

  if (goal.employeeId !== actorId && !isPrivileged(actorRole)) {
    const target = await prisma.employee.findUnique({ where: { id: goal.employeeId } });
    if (actorRole !== "MANAGER" || target?.reportingManagerId !== actorId) {
      throw new ForbiddenError("Only the employee, their manager, or HR Admin can update this goal");
    }
  }

  return prisma.goal.update({ where: { id: goalId }, data: { actual } });
}

async function getOrCreateReview(prisma: PrismaClient, cycleId: string, employeeId: string) {
  const existing = await prisma.review.findUnique({ where: { cycleId_employeeId: { cycleId, employeeId } } });
  if (existing) return existing;
  return prisma.review.create({ data: { cycleId, employeeId } });
}

export async function getReview(prisma: PrismaClient, cycleId: string, employeeId: string, requester: EmployeeDataRequester) {
  await assertCanAccessEmployeeData(prisma, employeeId, requester);
  return prisma.review.findUnique({
    where: { cycleId_employeeId: { cycleId, employeeId } },
    include: { corrections: true },
  });
}

// Acceptance Criteria: "Goal weightage validation blocks submission if it
// doesn't sum to 100%."
async function assertWeightageComplete(prisma: PrismaClient, cycleId: string, employeeId: string) {
  const goals = await prisma.goal.findMany({ where: { cycleId, employeeId } });
  const total = goals.reduce((sum, g) => sum + g.weightage, 0);
  if (Math.abs(total - 100) > WEIGHTAGE_TOLERANCE) {
    throw new BadRequestError(`Goal weightages must sum to 100% before submitting (currently ${total}%)`);
  }
}

export async function submitSelfAssessment(prisma: PrismaClient, dto: SubmitSelfAssessmentDto, actorId: string) {
  const cycle = await getOpenCycle(prisma, dto.cycleId);
  if (cycle.status === ReviewCycleStatus.CLOSED) {
    throw new BadRequestError("This cycle is closed — ratings are locked; use the correction workflow instead");
  }
  await assertWeightageComplete(prisma, dto.cycleId, actorId);

  const review = await getOrCreateReview(prisma, dto.cycleId, actorId);
  if (review.status === ReviewStatus.FINALIZED) {
    throw new BadRequestError("This review is finalized; use the correction workflow instead");
  }

  const updated = await prisma.review.update({
    where: { id: review.id },
    data: {
      selfAssessmentJson: dto.assessment as Prisma.InputJsonValue,
      status: deriveReviewStatus({ selfAssessmentJson: dto.assessment, managerAssessmentJson: review.managerAssessmentJson }),
    },
  });

  const employee = await prisma.employee.findUnique({ where: { id: actorId } });
  if (employee?.reportingManagerId) {
    await notify(prisma, {
      recipientId: employee.reportingManagerId,
      template: "performance.self-assessment-submitted",
      body: `${employee.firstName} ${employee.lastName} submitted their self-assessment and it's awaiting your review.`,
      data: { reviewId: updated.id },
    });
  }

  return updated;
}

export async function submitManagerAssessment(prisma: PrismaClient, dto: SubmitManagerAssessmentDto, actorId: string, actorRole?: Role) {
  const employee = await prisma.employee.findUnique({ where: { id: dto.employeeId } });
  if (!employee) throw new NotFoundError("Employee not found");
  if (employee.reportingManagerId !== actorId && !isPrivileged(actorRole)) {
    throw new ForbiddenError("Only this employee's manager or HR Admin can submit this assessment");
  }

  const cycle = await getOpenCycle(prisma, dto.cycleId);
  if (cycle.status === ReviewCycleStatus.CLOSED) {
    throw new BadRequestError("This cycle is closed — ratings are locked; use the correction workflow instead");
  }

  const review = await getOrCreateReview(prisma, dto.cycleId, dto.employeeId);
  if (review.status === ReviewStatus.FINALIZED) {
    throw new BadRequestError("This review is finalized; use the correction workflow instead");
  }
  // A manager's score locks the moment it's first given — not just at
  // cycle close — so it can't be silently re-edited.
  if (review.managerAssessmentJson != null) {
    throw new BadRequestError("A manager assessment was already submitted for this review");
  }

  return prisma.review.update({
    where: { id: review.id },
    data: {
      managerAssessmentJson: dto.assessment as Prisma.InputJsonValue,
      finalRating: dto.rating,
      status: deriveReviewStatus({ selfAssessmentJson: review.selfAssessmentJson, managerAssessmentJson: dto.assessment }),
    },
  });
}

// Acceptance Criteria: "A review cannot close without both self and manager
// sections submitted." — enforced per-employee at the point the whole cycle
// is closed.
export async function closeReviewCycle(prisma: PrismaClient, cycleId: string, actorId: string) {
  const cycle = await getOpenCycle(prisma, cycleId);
  if (cycle.status === ReviewCycleStatus.CLOSED) {
    throw new BadRequestError("This cycle is already closed");
  }

  const reviews = await prisma.review.findMany({ where: { cycleId } });
  const incomplete = reviews.filter((r) => r.selfAssessmentJson == null || r.managerAssessmentJson == null);
  if (incomplete.length > 0) {
    throw new BadRequestError(`${incomplete.length} review(s) are missing a self or manager assessment and cannot be finalized`);
  }

  const now = new Date();
  await prisma.$transaction([
    ...reviews.map((r) =>
      prisma.review.update({
        where: { id: r.id },
        data: { status: ReviewStatus.FINALIZED, finalizedBy: actorId, finalizedAt: now },
      }),
    ),
    prisma.reviewCycle.update({
      where: { id: cycleId },
      data: { status: ReviewCycleStatus.CLOSED, closedBy: actorId, closedAt: now },
    }),
  ]);

  await Promise.all(
    reviews.map((r) =>
      notify(prisma, {
        recipientId: r.employeeId,
        template: "performance.review-finalized",
        body: `Your review for the "${cycle.name}" cycle has been finalized.`,
        data: { reviewId: r.id },
      }),
    ),
  );

  return { status: "CLOSED", reviewsFinalized: reviews.length };
}

// Key Feature: "Calibration view for HR Admin to compare rating
// distributions across managers/departments before finalizing."
export async function getCalibrationView(prisma: PrismaClient, cycleId: string) {
  const reviews = await prisma.review.findMany({
    where: { cycleId, finalRating: { not: null } },
    include: { employee: { select: { departmentId: true, reportingManagerId: true } } },
  });

  const byDepartment: Record<string, number[]> = {};
  const byManager: Record<string, number[]> = {};
  for (const r of reviews) {
    const dept = r.employee.departmentId ?? "unassigned";
    const mgr = r.employee.reportingManagerId ?? "unassigned";
    (byDepartment[dept] ??= []).push(r.finalRating!);
    (byManager[mgr] ??= []).push(r.finalRating!);
  }

  const avg = (nums: number[]) => nums.reduce((a, b) => a + b, 0) / nums.length;

  return {
    totalRated: reviews.length,
    byDepartment: Object.fromEntries(Object.entries(byDepartment).map(([k, v]) => [k, { count: v.length, average: avg(v) }])),
    byManager: Object.fromEntries(Object.entries(byManager).map(([k, v]) => [k, { count: v.length, average: avg(v) }])),
  };
}

// Policy Section 2 "KPI Scoring and Governance": manager submits, HR/
// finance-compliance audits before it counts as final. Re-submitting for
// the same employee+period (e.g. after a send-back) overwrites the prior
// score and resets it to pending audit; once APPROVED it's locked, since
// the policy defines no correction workflow for monthly scores. Product
// decision: scoring is restricted to the employee's assigned manager
// specifically — unlike every other "manager or HR" check in this module,
// HR/Super Admin cannot submit a score on a manager's behalf.
export async function submitMonthlyEvaluation(prisma: PrismaClient, dto: SubmitMonthlyEvaluationDto, actorId: string) {
  const employee = await prisma.employee.findUnique({ where: { id: dto.employeeId } });
  if (!employee) throw new NotFoundError("Employee not found");
  if (employee.reportingManagerId !== actorId) {
    throw new ForbiddenError("Only this employee's assigned manager can submit a monthly evaluation");
  }

  const period = normalizeToMonthStart(new Date(dto.period));
  const existing = await prisma.monthlyEvaluation.findUnique({
    where: { employeeId_period: { employeeId: dto.employeeId, period } },
  });
  if (existing?.auditStatus === EvaluationAuditStatus.APPROVED) {
    throw new BadRequestError("This month has already been audited and approved; it cannot be resubmitted");
  }

  const grade = computeGrade(dto.kpiScore);
  const evaluation = await prisma.monthlyEvaluation.upsert({
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

  const superAdminIds = await listSuperAdminIds(prisma);
  await Promise.all(
    superAdminIds.map((id) =>
      notify(prisma, {
        recipientId: id,
        template: "performance.monthly-evaluation-submitted",
        body: `A monthly evaluation for employee ${dto.employeeId} (period ${period.toISOString().slice(0, 10)}, grade ${grade}) was submitted and is awaiting audit.`,
        data: { evaluationId: evaluation.id, employeeId: dto.employeeId },
      }),
    ),
  );

  return evaluation;
}

// Only SUPER_ADMIN can audit monthly scores in this module (an established,
// explicit product decision — HR_ADMIN has no audit role here), so this is
// the actual notification audience.
async function listSuperAdminIds(prisma: PrismaClient): Promise<string[]> {
  const admins = await prisma.employee.findMany({ where: { role: "SUPER_ADMIN" }, select: { id: true } });
  return admins.map((a) => a.id);
}

// "Scores may be sent back for clarification or validation where required"
// — auditNotes is required in that case since there's nothing else pointing
// the manager at what to fix.
export async function auditMonthlyEvaluation(prisma: PrismaClient, evaluationId: string, dto: AuditMonthlyEvaluationDto, actorId: string) {
  const evaluation = await prisma.monthlyEvaluation.findUnique({ where: { id: evaluationId } });
  if (!evaluation) throw new NotFoundError("Monthly evaluation not found");
  if (evaluation.auditStatus !== EvaluationAuditStatus.PENDING_AUDIT) {
    throw new BadRequestError("This evaluation is not pending audit");
  }
  if (!dto.approve && !dto.auditNotes) {
    throw new BadRequestError("auditNotes is required when sending an evaluation back for clarification");
  }

  const updated = await prisma.monthlyEvaluation.update({
    where: { id: evaluationId },
    data: {
      auditStatus: dto.approve ? EvaluationAuditStatus.APPROVED : EvaluationAuditStatus.SENT_BACK,
      auditedBy: actorId,
      auditedAt: new Date(),
      auditNotes: dto.auditNotes ?? null,
    },
  });

  await notify(prisma, {
    recipientId: updated.submittedBy,
    template: dto.approve ? "performance.monthly-evaluation-approved" : "performance.monthly-evaluation-sent-back",
    body: dto.approve
      ? `The monthly evaluation you submitted for ${updated.period.toISOString().slice(0, 10)} was approved.`
      : `The monthly evaluation you submitted for ${updated.period.toISOString().slice(0, 10)} was sent back for clarification.${dto.auditNotes ? ` Comment: "${dto.auditNotes}"` : ""}`,
    data: { evaluationId: updated.id },
  });

  return updated;
}

// Orchestration for the daily score-release job — the "what's due" query
// lives here, filtered to APPROVED-and-not-yet-notified rows first in SQL,
// then to those actually past their release date.
export async function findDueMonthlyReleases(prisma: PrismaClient) {
  const now = new Date();
  const candidates = await prisma.monthlyEvaluation.findMany({
    where: { auditStatus: EvaluationAuditStatus.APPROVED, releaseNotifiedAt: null },
  });
  return candidates.filter((e) => now >= monthlyReleaseDate(e.period));
}

export async function markMonthlyReleaseNotified(prisma: PrismaClient, id: string) {
  await prisma.monthlyEvaluation.update({ where: { id }, data: { releaseNotifiedAt: new Date() } });
}

// Product decision: unlike goals/reviews (isPrivileged — HR_ADMIN or
// SUPER_ADMIN), monthly KPI evaluations can be browsed/audited across the
// whole company by SUPER_ADMIN only. HR_ADMIN keeps exactly the same
// access as everyone else here — self, or an employee who actually reports
// to them.
async function assertCanViewEvaluations(prisma: PrismaClient, employeeId: string, actorId: string, actorRole?: Role) {
  if (employeeId === actorId || actorRole === "SUPER_ADMIN") return;
  const employee = await prisma.employee.findUnique({ where: { id: employeeId } });
  if (employee?.reportingManagerId === actorId) return;
  throw new ForbiddenError("Not authorized to view this employee's evaluations");
}

export async function listMonthlyEvaluations(prisma: PrismaClient, employeeId: string, actorId: string, actorRole?: Role) {
  await assertCanViewEvaluations(prisma, employeeId, actorId, actorRole);
  const evaluations = await prisma.monthlyEvaluation.findMany({
    where: { employeeId },
    orderBy: { period: "desc" },
  });
  return employeeId === actorId ? evaluations.map(redactForSubject) : evaluations.map(withKpiPercent);
}

export async function getMonthlyEvaluation(prisma: PrismaClient, id: string, actorId: string, actorRole?: Role) {
  const evaluation = await prisma.monthlyEvaluation.findUnique({ where: { id } });
  if (!evaluation) throw new NotFoundError("Monthly evaluation not found");
  await assertCanViewEvaluations(prisma, evaluation.employeeId, actorId, actorRole);
  return evaluation.employeeId === actorId ? redactForSubject(evaluation) : withKpiPercent(evaluation);
}

// P&B effective January 2026, "3a. Member KPI Linked Rewards" — the yearly
// reward ceiling for the CTC band the employee's current ctcLpa falls into.
// Paid quarterly (yearlyLimit / 4), scaled by that quarter's average KPI%.
const KPI_REWARD_CTC_BANDS: { maxLpa: number | null; label: string; yearlyLimit: number }[] = [
  { maxLpa: 15, label: "0-15 LPA", yearlyLimit: 86400 },
  { maxLpa: 25, label: "15-25 LPA", yearlyLimit: 116600 },
  { maxLpa: 35, label: "25-35 LPA", yearlyLimit: 140000 },
  { maxLpa: null, label: "35+ LPA", yearlyLimit: 156400 },
];

function resolveKpiRewardBand(ctcLpa: number) {
  return (
    KPI_REWARD_CTC_BANDS.find((b) => b.maxLpa !== null && ctcLpa <= b.maxLpa) ??
    KPI_REWARD_CTC_BANDS[KPI_REWARD_CTC_BANDS.length - 1]
  );
}

// Quarter 1 = Jan-Mar, Quarter 2 = Apr-Jun, etc. — calendar-year quarters.
function quarterMonthStarts(year: number, quarter: number): Date[] {
  const startMonth = (quarter - 1) * 3;
  return [0, 1, 2].map((i) => new Date(Date.UTC(year, startMonth + i, 1)));
}

// Performance Evaluation Policy 2026 Section 6 "Incentives & Recognition" +
// P&B "3a. Member KPI Linked Rewards": one quarter's payout, computed fresh
// from whatever's currently APPROVED rather than persisted anywhere — it
// can only ever move in step with the audited monthly scores it's built
// from, never drift out of sync with a correction made after the fact.
async function computeQuarterlyKpiReward(
  prisma: PrismaClient,
  employeeId: string,
  ctcLpa: number | null,
  year: number,
  quarter: number,
) {
  const periods = quarterMonthStarts(year, quarter);
  const evaluations = await prisma.monthlyEvaluation.findMany({
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
          ? "CTC is not set for this employee yet"
          : "Not all three months of this quarter have an approved evaluation yet",
    };
  }

  // Average the raw scores once, then convert to a percentage — averaging
  // three already-rounded percentages compounds rounding error for no
  // reason.
  const avgKpiScore = months.reduce((sum, m) => sum + (m.kpiScore ?? 0), 0) / months.length;
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
export async function listQuarterlyKpiRewards(
  prisma: PrismaClient,
  employeeId: string,
  year: number,
  actorId: string,
  actorRole?: Role,
) {
  await assertCanViewEvaluations(prisma, employeeId, actorId, actorRole);
  const employee = await prisma.employee.findUnique({ where: { id: employeeId } });
  if (!employee) throw new NotFoundError("Employee not found");

  const quarters = await Promise.all(
    [1, 2, 3, 4].map((q) => computeQuarterlyKpiReward(prisma, employeeId, employee.ctcLpa, year, q)),
  );
  return { employeeId, year, ctcLpa: employee.ctcLpa, quarters };
}
