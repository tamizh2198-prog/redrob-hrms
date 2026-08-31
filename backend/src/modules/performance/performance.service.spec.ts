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
    monthlyEvaluation: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
    },
    // Defaults to no Super Admins found — most tests here don't care about
    // the submit-time notification fan-out; tests that do override this.
    employee: { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn() },
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

  describe('Review Cycle types: Monthly/Quarterly/Yearly', () => {
    beforeEach(() => {
      prisma.employee.findMany.mockResolvedValue([]);
      prisma.reviewCycle.create.mockImplementation(
        ({ data }: { data: Record<string, unknown> }) =>
          Promise.resolve({ id: 'cycle-new', ...data }),
      );
    });

    it('defaults to QUARTERLY when cycleType is omitted, preserving existing behavior', async () => {
      await service.openReviewCycle({
        name: 'FY26 Q1',
        periodStart: '2026-01-01',
        periodEnd: '2026-03-31',
      } as never);

      expect(prisma.reviewCycle.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            cycleType: 'QUARTERLY',
            periodStart: new Date('2026-01-01'),
            periodEnd: new Date('2026-03-31'),
          }),
        }),
      );
    });

    it('honors an explicit periodEnd as-is regardless of cycleType (no behavior change for existing callers)', async () => {
      await service.openReviewCycle({
        name: 'FY26 Q1 custom',
        cycleType: 'QUARTERLY',
        periodStart: '2026-01-01',
        periodEnd: '2026-03-15',
      } as never);

      expect(prisma.reviewCycle.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            periodEnd: new Date('2026-03-15'),
          }),
        }),
      );
    });

    it('derives a 1-month period end for MONTHLY when periodEnd is omitted', async () => {
      await service.openReviewCycle({
        name: 'Jan 2026 Monthly',
        cycleType: 'MONTHLY',
        periodStart: '2026-01-01',
      } as never);

      expect(prisma.reviewCycle.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            cycleType: 'MONTHLY',
            periodEnd: new Date('2026-02-01'),
          }),
        }),
      );
    });

    it('derives a 3-month period end for QUARTERLY when periodEnd is omitted', async () => {
      await service.openReviewCycle({
        name: 'FY26 Q1',
        cycleType: 'QUARTERLY',
        periodStart: '2026-01-01',
      } as never);

      expect(prisma.reviewCycle.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            cycleType: 'QUARTERLY',
            periodEnd: new Date('2026-04-01'),
          }),
        }),
      );
    });

    it('derives a 12-month period end for YEARLY when periodEnd is omitted', async () => {
      await service.openReviewCycle({
        name: 'FY26 Annual',
        cycleType: 'YEARLY',
        periodStart: '2026-01-01',
      } as never);

      expect(prisma.reviewCycle.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            cycleType: 'YEARLY',
            periodEnd: new Date('2027-01-01'),
          }),
        }),
      );
    });
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

  describe('Acceptance Criteria: a submitted rating is immutable outside the correction workflow', () => {
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

    it('rejects re-submitting a manager assessment once one already exists, even mid-cycle', async () => {
      prisma.employee.findUnique.mockResolvedValue({
        reportingManagerId: 'mgr-1',
      });
      prisma.reviewCycle.findUnique.mockResolvedValue({
        id: 'cycle-1',
        status: 'OPEN',
      });
      prisma.review.findUnique.mockResolvedValue({
        id: 'review-1',
        status: 'IN_PROGRESS',
        managerAssessmentJson: { rating: 3 },
      });

      await expect(
        service.submitManagerAssessment(
          {
            cycleId: 'cycle-1',
            employeeId: 'emp-1',
            assessment: { rating: 5 },
            rating: 5,
          },
          'mgr-1',
        ),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.review.update).not.toHaveBeenCalled();
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

    it('lets HR Associate create a goal for anyone, like HR Admin, even when not their report', async () => {
      prisma.reviewCycle.findUnique.mockResolvedValue({
        id: 'cycle-1',
        status: 'OPEN',
      });
      prisma.goal.create.mockResolvedValue({ id: 'goal-1' });

      await expect(
        service.createGoal(
          {
            employeeId: 'emp-2',
            cycleId: 'cycle-1',
            title: 'X',
            weightage: 50,
          },
          'ha-1',
          Role.HR_ASSOCIATE,
        ),
      ).resolves.toBeDefined();
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
        period: new Date('2026-01-01'),
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
          // Well in the past so it's also past its release date (the 3rd of
          // the month after) — this test is about confidentiality, not
          // release timing, which has its own describe block below.
          period: new Date('2025-01-01'),
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

    it("rejects an HR Admin who isn't this employee's manager — only Super Admin gets the company-wide bypass", async () => {
      prisma.employee.findUnique.mockResolvedValue({
        id: 'emp-1',
        reportingManagerId: 'mgr-1',
      });

      await expect(
        service.listMonthlyEvaluations('emp-1', 'hr-1', Role.HR_ADMIN),
      ).rejects.toThrow(ForbiddenException);
    });

    it('lets a Super Admin view any employee\'s evaluations', async () => {
      prisma.employee.findUnique.mockResolvedValue({
        id: 'emp-1',
        reportingManagerId: 'mgr-1',
      });
      prisma.monthlyEvaluation.findMany.mockResolvedValue([
        { id: 'eval-1', employeeId: 'emp-1', kpiScore: 900, grade: 'EE' },
      ]);

      const result = await service.listMonthlyEvaluations(
        'emp-1',
        'sa-1',
        Role.SUPER_ADMIN,
      );

      expect(result[0].kpiScore).toBe(900);
    });
  });

  describe('submitMonthlyEvaluation notifies real Super Admins (fixes the dead "hr-admin" placeholder)', () => {
    it('notifies every Super Admin, not the literal string "hr-admin"', async () => {
      prisma.employee.findUnique.mockResolvedValue({
        id: 'emp-1',
        reportingManagerId: 'mgr-1',
      });
      prisma.employee.findMany.mockResolvedValue([{ id: 'sa-1' }, { id: 'sa-2' }]);
      prisma.monthlyEvaluation.findUnique.mockResolvedValue(null);
      prisma.monthlyEvaluation.upsert.mockImplementation(({ create }) =>
        Promise.resolve({ id: 'eval-1', ...create }),
      );

      await service.submitMonthlyEvaluation(
        { employeeId: 'emp-1', period: '2026-08-01', kpiScore: 800, justification: 'x' },
        'mgr-1',
      );

      expect(notifications.send).toHaveBeenCalledWith(
        expect.objectContaining({ recipientId: 'sa-1' }),
      );
      expect(notifications.send).toHaveBeenCalledWith(
        expect.objectContaining({ recipientId: 'sa-2' }),
      );
      expect(notifications.send).not.toHaveBeenCalledWith(
        expect.objectContaining({ recipientId: 'hr-admin' }),
      );
    });
  });

  describe('Monthly score release gating: hidden from the subject until approved AND past the 3rd of next month', () => {
    it('hides the score from the subject while still pending audit', async () => {
      prisma.monthlyEvaluation.findMany.mockResolvedValue([
        { id: 'eval-1', employeeId: 'emp-1', period: new Date('2025-01-01'), kpiScore: 900, grade: 'EE', auditStatus: 'PENDING_AUDIT' },
      ]);

      const result = await service.listMonthlyEvaluations('emp-1', 'emp-1', Role.EMPLOYEE);

      expect(result[0].kpiScore).toBeNull();
      expect(result[0].grade).toBeNull();
      expect(result[0].auditStatus).toBe('PENDING_AUDIT');
    });

    it("hides an APPROVED score from the subject until the 3rd of the month after the period", async () => {
      prisma.monthlyEvaluation.findMany.mockResolvedValue([
        // Today is well after 2026-08 per the test clock (see system date),
        // but this period is deliberately the *current* month so its release
        // date (3rd of next month) hasn't arrived yet regardless of when
        // this suite runs relative to the 3rd.
        { id: 'eval-1', employeeId: 'emp-1', period: new Date(Date.UTC(9999, 0, 1)), kpiScore: 900, grade: 'EE', auditStatus: 'APPROVED' },
      ]);

      const result = await service.listMonthlyEvaluations('emp-1', 'emp-1', Role.EMPLOYEE);

      expect(result[0].kpiScore).toBeNull();
      expect((result[0] as { releaseDate: Date }).releaseDate).toEqual(
        new Date(Date.UTC(9999, 1, 3)),
      );
    });

    it('shows an APPROVED score once past its release date', async () => {
      prisma.monthlyEvaluation.findMany.mockResolvedValue([
        { id: 'eval-1', employeeId: 'emp-1', period: new Date('2025-01-01'), kpiScore: 900, grade: 'EE', auditStatus: 'APPROVED' },
      ]);

      const result = await service.listMonthlyEvaluations('emp-1', 'emp-1', Role.EMPLOYEE);

      expect(result[0].kpiScore).toBe(900);
      expect(result[0].grade).toBe('EE');
    });

    it("does not gate the manager's or Super Admin's own view of the score", async () => {
      prisma.employee.findUnique.mockResolvedValue({ id: 'emp-1', reportingManagerId: 'mgr-1' });
      prisma.monthlyEvaluation.findMany.mockResolvedValue([
        { id: 'eval-1', employeeId: 'emp-1', period: new Date(Date.UTC(9999, 0, 1)), kpiScore: 900, grade: 'EE', auditStatus: 'APPROVED' },
      ]);

      const result = await service.listMonthlyEvaluations('emp-1', 'mgr-1', Role.MANAGER);

      expect(result[0].kpiScore).toBe(900);
    });
  });

  describe('Release-notification cron queries', () => {
    it('findDueMonthlyReleases returns only APPROVED, not-yet-notified rows past their release date', async () => {
      prisma.monthlyEvaluation.findMany.mockResolvedValue([
        { id: 'eval-past', period: new Date('2025-01-01') },
        { id: 'eval-future', period: new Date(Date.UTC(9999, 0, 1)) },
      ]);

      const due = await service.findDueMonthlyReleases();

      expect(due.map((e: { id: string }) => e.id)).toEqual(['eval-past']);
      expect(prisma.monthlyEvaluation.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { auditStatus: 'APPROVED', releaseNotifiedAt: null },
        }),
      );
    });

    it('markMonthlyReleaseNotified stamps releaseNotifiedAt', async () => {
      await service.markMonthlyReleaseNotified('eval-1');
      expect(prisma.monthlyEvaluation.update).toHaveBeenCalledWith({
        where: { id: 'eval-1' },
        data: { releaseNotifiedAt: expect.any(Date) },
      });
    });
  });
});
