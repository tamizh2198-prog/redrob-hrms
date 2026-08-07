import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { PerformanceService } from './performance.service';
import { PrismaService } from '../../shared/database/prisma.service';
import { DefaultCompanyService } from '../../shared/database/default-company.service';
import { NotificationService } from '../../shared/notifications/notification.service';

function createMockPrisma() {
  return {
    reviewCycle: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
    goal: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    review: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
    },
    reviewCorrection: { create: jest.fn() },
    monthlyEvaluation: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
    },
    employee: { findMany: jest.fn(), findUnique: jest.fn() },
    $transaction: jest.fn((ops: unknown[]) => Promise.all(ops)),
  };
}

function createMockNotifications() {
  return { send: jest.fn().mockResolvedValue(undefined) };
}

function createMockDefaultCompany() {
  return { getOrCreate: jest.fn().mockResolvedValue('company-1') };
}

describe('PerformanceService', () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let notifications: ReturnType<typeof createMockNotifications>;
  let defaultCompany: ReturnType<typeof createMockDefaultCompany>;
  let service: PerformanceService;

  beforeEach(() => {
    prisma = createMockPrisma();
    notifications = createMockNotifications();
    defaultCompany = createMockDefaultCompany();
    service = new PerformanceService(
      prisma as unknown as PrismaService,
      defaultCompany as unknown as DefaultCompanyService,
      notifications as unknown as NotificationService,
    );
  });

  describe('Acceptance Criteria: goal weightage validation blocks submission if it does not sum to 100%', () => {
    it('rejects self-assessment submission when weightages sum to less than 100%', async () => {
      prisma.reviewCycle.findUnique.mockResolvedValue({
        id: 'cycle-1',
        status: 'OPEN',
      });
      prisma.goal.findMany.mockResolvedValue([
        { weightage: 40 },
        { weightage: 30 },
      ]);

      await expect(
        service.submitSelfAssessment(
          { cycleId: 'cycle-1', assessment: { notes: 'x' } },
          'emp-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('allows submission once weightages sum to exactly 100%', async () => {
      prisma.reviewCycle.findUnique.mockResolvedValue({
        id: 'cycle-1',
        status: 'OPEN',
      });
      prisma.goal.findMany.mockResolvedValue([
        { weightage: 60 },
        { weightage: 40 },
      ]);
      prisma.review.findUnique.mockResolvedValue(null);
      prisma.review.create.mockResolvedValue({
        id: 'review-1',
        selfAssessmentJson: null,
        managerAssessmentJson: null,
        status: 'NOT_STARTED',
      });
      prisma.review.update.mockResolvedValue({ id: 'review-1' });
      prisma.employee.findUnique.mockResolvedValue({
        reportingManagerId: 'mgr-1',
      });

      await expect(
        service.submitSelfAssessment(
          { cycleId: 'cycle-1', assessment: { notes: 'x' } },
          'emp-1',
        ),
      ).resolves.toBeDefined();
      expect(prisma.review.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'IN_PROGRESS' }),
        }),
      );
    });
  });

  describe('Acceptance Criteria: a review cannot close without both self and manager sections', () => {
    it('rejects closing the cycle when a review is missing a section', async () => {
      prisma.reviewCycle.findUnique.mockResolvedValue({
        id: 'cycle-1',
        status: 'OPEN',
      });
      prisma.review.findMany.mockResolvedValue([
        { id: 'r1', selfAssessmentJson: { a: 1 }, managerAssessmentJson: null },
      ]);

      await expect(service.closeReviewCycle('cycle-1', 'hr-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('finalizes every review and closes the cycle once all sections are present', async () => {
      prisma.reviewCycle.findUnique.mockResolvedValue({
        id: 'cycle-1',
        status: 'OPEN',
      });
      prisma.review.findMany.mockResolvedValue([
        {
          id: 'r1',
          employeeId: 'emp-1',
          selfAssessmentJson: { a: 1 },
          managerAssessmentJson: { b: 1 },
        },
      ]);
      prisma.review.update.mockResolvedValue({});
      prisma.reviewCycle.update.mockResolvedValue({});

      const result = await service.closeReviewCycle('cycle-1', 'hr-1');
      expect(result).toEqual({ status: 'CLOSED', reviewsFinalized: 1 });
      expect(prisma.reviewCycle.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'CLOSED' }),
        }),
      );
    });
  });

  describe('Acceptance Criteria: closed-cycle ratings are immutable outside the correction workflow', () => {
    it('rejects submitting a self-assessment against a closed cycle', async () => {
      prisma.reviewCycle.findUnique.mockResolvedValue({
        id: 'cycle-1',
        status: 'CLOSED',
      });

      await expect(
        service.submitSelfAssessment(
          { cycleId: 'cycle-1', assessment: {} },
          'emp-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a correction on a review whose cycle is still open', async () => {
      prisma.review.findUnique.mockResolvedValue({
        id: 'review-1',
        finalRating: 4,
        cycle: { status: 'OPEN' },
      });

      await expect(
        service.correctRating(
          'review-1',
          { newRating: 5, reason: 'Recalculated' },
          'hr-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('records a documented correction and bumps the version once the cycle is closed', async () => {
      prisma.review.findUnique.mockResolvedValue({
        id: 'review-1',
        finalRating: 4,
        cycle: { status: 'CLOSED' },
      });
      prisma.reviewCorrection.create.mockResolvedValue({});
      prisma.review.update.mockResolvedValue({
        id: 'review-1',
        finalRating: 5,
      });

      await service.correctRating(
        'review-1',
        {
          newRating: 5,
          reason: 'Manager under-scored due to data entry error',
        },
        'hr-1',
      );

      expect(prisma.reviewCorrection.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            previousRating: 4,
            newRating: 5,
            correctedBy: 'hr-1',
          }),
        }),
      );
      expect(prisma.review.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            finalRating: 5,
            version: { increment: 1 },
          }),
        }),
      );
    });
  });

  describe('Access control: goals and manager assessments', () => {
    it("rejects an unrelated manager submitting an employee's manager assessment", async () => {
      prisma.employee.findUnique.mockResolvedValue({
        reportingManagerId: 'mgr-real',
      });

      await expect(
        service.submitManagerAssessment(
          {
            cycleId: 'cycle-1',
            employeeId: 'emp-1',
            assessment: {},
            rating: 4,
          },
          'mgr-imposter',
          Role.MANAGER,
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it("rejects a manager creating a goal for someone who isn't their report", async () => {
      prisma.employee.findUnique.mockResolvedValue({
        reportingManagerId: 'someone-else',
      });

      await expect(
        service.createGoal(
          {
            employeeId: 'emp-2',
            cycleId: 'cycle-1',
            title: 'X',
            weightage: 50,
          },
          'mgr-1',
          Role.MANAGER,
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rejects a plain employee creating a goal for anyone else at all', async () => {
      await expect(
        service.createGoal(
          {
            employeeId: 'emp-2',
            cycleId: 'cycle-1',
            title: 'X',
            weightage: 50,
          },
          'emp-1',
          Role.EMPLOYEE,
        ),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('Acceptance Criteria: monthly KPI score maps to the correct grade', () => {
    it.each([
      [1000, 'FEE'],
      [950, 'FEE'],
      [949, 'EE'],
      [850, 'EE'],
      [849, 'ME'],
      [700, 'ME'],
      [699, 'PME'],
      [600, 'PME'],
      [599, 'DNME'],
      [0, 'DNME'],
    ])('maps a score of %i to grade %s', async (kpiScore, grade) => {
      prisma.employee.findUnique.mockResolvedValue({
        id: 'emp-1',
        reportingManagerId: 'mgr-1',
      });
      prisma.monthlyEvaluation.findUnique.mockResolvedValue(null);
      prisma.monthlyEvaluation.upsert.mockImplementation(({ create }) =>
        Promise.resolve({ id: 'eval-1', ...create }),
      );

      const result = await service.submitMonthlyEvaluation(
        {
          employeeId: 'emp-1',
          period: '2026-08-01',
          kpiScore,
          justification: 'Solid month',
        },
        'mgr-1',
      );

      expect(result.grade).toBe(grade);
    });
  });

  describe("Acceptance Criteria: only the employee's assigned manager can submit a monthly evaluation", () => {
    it("rejects an unrelated manager submitting an employee's evaluation", async () => {
      prisma.employee.findUnique.mockResolvedValue({
        id: 'emp-1',
        reportingManagerId: 'mgr-real',
      });

      await expect(
        service.submitMonthlyEvaluation(
          {
            employeeId: 'emp-1',
            period: '2026-08-01',
            kpiScore: 800,
            justification: 'x',
          },
          'mgr-imposter',
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it("rejects HR Admin submitting a score on the manager's behalf", async () => {
      prisma.employee.findUnique.mockResolvedValue({
        id: 'emp-1',
        reportingManagerId: 'mgr-real',
      });

      await expect(
        service.submitMonthlyEvaluation(
          {
            employeeId: 'emp-1',
            period: '2026-08-01',
            kpiScore: 800,
            justification: 'x',
          },
          'hr-1',
        ),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('Acceptance Criteria: an approved evaluation cannot be resubmitted', () => {
    it('rejects resubmission once the evaluation is already APPROVED', async () => {
      prisma.employee.findUnique.mockResolvedValue({
        id: 'emp-1',
        reportingManagerId: 'mgr-1',
      });
      prisma.monthlyEvaluation.findUnique.mockResolvedValue({
        id: 'eval-1',
        auditStatus: 'APPROVED',
      });

      await expect(
        service.submitMonthlyEvaluation(
          {
            employeeId: 'emp-1',
            period: '2026-08-01',
            kpiScore: 800,
            justification: 'x',
          },
          'mgr-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('Acceptance Criteria: audit workflow can approve or send back a pending evaluation', () => {
    it('rejects auditing an evaluation that is not pending audit', async () => {
      prisma.monthlyEvaluation.findUnique.mockResolvedValue({
        id: 'eval-1',
        auditStatus: 'APPROVED',
      });

      await expect(
        service.auditMonthlyEvaluation('eval-1', { approve: true }, 'hr-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('requires auditNotes when sending an evaluation back', async () => {
      prisma.monthlyEvaluation.findUnique.mockResolvedValue({
        id: 'eval-1',
        auditStatus: 'PENDING_AUDIT',
      });

      await expect(
        service.auditMonthlyEvaluation('eval-1', { approve: false }, 'hr-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('approves a pending evaluation and notifies the submitting manager', async () => {
      prisma.monthlyEvaluation.findUnique.mockResolvedValue({
        id: 'eval-1',
        auditStatus: 'PENDING_AUDIT',
        submittedBy: 'mgr-1',
      });
      prisma.monthlyEvaluation.update.mockResolvedValue({
        id: 'eval-1',
        auditStatus: 'APPROVED',
        submittedBy: 'mgr-1',
      });

      await service.auditMonthlyEvaluation('eval-1', { approve: true }, 'hr-1');

      expect(notifications.send).toHaveBeenCalledWith(
        expect.objectContaining({
          recipientId: 'mgr-1',
          template: 'performance.monthly-evaluation-approved',
        }),
      );
    });
  });

  describe('Acceptance Criteria: employees see their score and grade, but never who scored them or why', () => {
    it("shows kpiScore and grade but redacts justification and submittedBy from the evaluation's own subject", async () => {
      prisma.monthlyEvaluation.findMany.mockResolvedValue([
        {
          id: 'eval-1',
          employeeId: 'emp-1',
          period: new Date('2026-08-01'),
          kpiScore: 900,
          grade: 'EE',
          justification: 'Great work',
          submittedBy: 'mgr-1',
          auditStatus: 'APPROVED',
          auditNotes: null,
        },
      ]);

      const result = await service.listMonthlyEvaluations(
        'emp-1',
        'emp-1',
        Role.EMPLOYEE,
      );

      expect(result[0].kpiScore).toBe(900);
      expect(result[0].grade).toBe('EE');
      expect(result[0]).not.toHaveProperty('justification');
      expect(result[0]).not.toHaveProperty('submittedBy');
      expect(result[0]).not.toHaveProperty('auditNotes');
    });

    it("shows the full record, including kpiScore, to the employee's manager", async () => {
      prisma.employee.findUnique.mockResolvedValue({
        id: 'emp-1',
        reportingManagerId: 'mgr-1',
      });
      prisma.monthlyEvaluation.findMany.mockResolvedValue([
        { id: 'eval-1', employeeId: 'emp-1', kpiScore: 900, grade: 'EE' },
      ]);

      const result = await service.listMonthlyEvaluations(
        'emp-1',
        'mgr-1',
        Role.MANAGER,
      );

      expect(result[0].kpiScore).toBe(900);
    });

    it("rejects an unrelated employee viewing someone else's evaluations", async () => {
      prisma.employee.findUnique.mockResolvedValue({
        id: 'emp-1',
        reportingManagerId: 'mgr-1',
      });

      await expect(
        service.listMonthlyEvaluations('emp-1', 'emp-2', Role.EMPLOYEE),
      ).rejects.toThrow(ForbiddenException);
    });
  });
});
