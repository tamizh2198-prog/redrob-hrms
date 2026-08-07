import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, ReviewCycleStatus, ReviewStatus, Role } from '@prisma/client';
import { PrismaService } from '../../shared/database/prisma.service';
import { DefaultCompanyService } from '../../shared/database/default-company.service';
import { NotificationService } from '../../shared/notifications/notification.service';
import { CreateGoalDto } from './dto/create-goal.dto';
import { OpenReviewCycleDto } from './dto/open-review-cycle.dto';
import { SubmitSelfAssessmentDto } from './dto/submit-self-assessment.dto';
import { SubmitManagerAssessmentDto } from './dto/submit-manager-assessment.dto';
import { CorrectRatingDto } from './dto/correct-rating.dto';

const WEIGHTAGE_TOLERANCE = 0.01;

function isPrivileged(role?: Role): boolean {
  return role === Role.HR_ADMIN || role === Role.SUPER_ADMIN;
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
    const cycle = await this.prisma.reviewCycle.create({
      data: {
        companyId,
        name: dto.name,
        periodStart: new Date(dto.periodStart),
        periodEnd: new Date(dto.periodEnd),
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

  listGoals(employeeId: string, cycleId?: string) {
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

  getReview(cycleId: string, employeeId: string) {
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
}
