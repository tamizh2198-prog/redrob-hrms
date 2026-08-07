import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import {
  EmploymentType,
  Gender,
  EmployeeStatus,
  PrismaClient,
  Role,
} from '@prisma/client';
import { AppModule } from '../src/app.module';

describe('ATS + Onboarding (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaClient;

  let companyId: string;
  let departmentId: string;
  let designationId: string;

  let hrAdminId: string;
  let hiringManagerId: string;
  let otherManagerId: string;
  let employeeId: string;

  let hrAdminToken: string;
  let hiringManagerToken: string;
  let otherManagerToken: string;
  let employeeToken: string;

  let templateId: string;
  let requisitionId: string;

  let candidate1Id: string; // reaches OFFER -> ACCEPT
  let candidate2Id: string; // reaches OFFER -> DECLINE
  let interviewRound1Id: string;
  let interviewRound2Id: string;
  let offer1Id: string;
  let offer2Id: string;
  let offerResponseToken: string;
  let offer2ResponseToken: string;

  let newHireEmployeeId: string;
  let preboardingToken: string;

  const baseFields = {
    dob: new Date('1990-01-01'),
    gender: Gender.PREFER_NOT_TO_SAY,
    dateOfJoining: new Date('2027-01-01'),
    employmentType: EmploymentType.FULL_TIME,
    status: EmployeeStatus.ACTIVE,
    pan: 'ABCDE1234F',
    bankAccountNumber: '000123456789',
    emergencyContactName: 'Emergency Contact',
    emergencyContactPhone: '9999999999',
  };

  async function login(employeeCode: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/dev-login')
      .send({ employeeCode })
      .expect(201);
    return res.body.accessToken;
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();

    prisma = new PrismaClient();

    const company = await prisma.company.create({
      data: { name: 'ATS-Onboarding E2E Co' },
    });
    companyId = company.id;

    const department = await prisma.department.create({
      data: { companyId, name: 'AO Dept', code: `AO-DEPT-${Date.now()}` },
    });
    departmentId = department.id;

    const designation = await prisma.designation.create({
      data: { companyId, name: 'AO Role', code: `AO-DESIG-${Date.now()}` },
    });
    designationId = designation.id;

    const hrAdmin = await prisma.employee.create({
      data: {
        ...baseFields,
        companyId,
        departmentId,
        designationId,
        employeeCode: `AO-HR-${Date.now()}`,
        firstName: 'AO',
        lastName: 'HrAdmin',
        role: Role.HR_ADMIN,
      },
    });
    hrAdminId = hrAdmin.id;

    const hiringManager = await prisma.employee.create({
      data: {
        ...baseFields,
        companyId,
        departmentId,
        designationId,
        employeeCode: `AO-HM-${Date.now()}`,
        firstName: 'AO',
        lastName: 'HiringManager',
        role: Role.MANAGER,
        reportingManagerId: hrAdminId,
      },
    });
    hiringManagerId = hiringManager.id;

    const otherManager = await prisma.employee.create({
      data: {
        ...baseFields,
        companyId,
        departmentId,
        designationId,
        employeeCode: `AO-OM-${Date.now()}`,
        firstName: 'AO',
        lastName: 'OtherManager',
        role: Role.MANAGER,
        reportingManagerId: hrAdminId,
      },
    });
    otherManagerId = otherManager.id;

    const employee = await prisma.employee.create({
      data: {
        ...baseFields,
        companyId,
        departmentId,
        designationId,
        employeeCode: `AO-EMP-${Date.now()}`,
        firstName: 'AO',
        lastName: 'Employee',
        role: Role.EMPLOYEE,
        reportingManagerId: hiringManagerId,
      },
    });
    employeeId = employee.id;

    hrAdminToken = await login(hrAdmin.employeeCode);
    hiringManagerToken = await login(hiringManager.employeeCode);
    otherManagerToken = await login(otherManager.employeeCode);
    employeeToken = await login(employee.employeeCode);
  });

  afterAll(async () => {
    if (newHireEmployeeId) {
      await prisma.preboardingSubmission.deleteMany({
        where: { employeeId: newHireEmployeeId },
      });
      const checklist = await prisma.onboardingChecklist.findUnique({
        where: { employeeId: newHireEmployeeId },
      });
      if (checklist) {
        await prisma.checklistTask.deleteMany({
          where: { checklistId: checklist.id },
        });
        await prisma.onboardingChecklist.delete({
          where: { id: checklist.id },
        });
      }
      await prisma.employeeHistory.deleteMany({
        where: { employeeId: newHireEmployeeId },
      });
    }
    if (templateId) {
      await prisma.checklistTaskTemplate.deleteMany({ where: { templateId } });
      await prisma.onboardingChecklistTemplate.delete({
        where: { id: templateId },
      });
    }
    await prisma.offer.deleteMany({
      where: {
        candidateId: { in: [candidate1Id, candidate2Id].filter(Boolean) },
      },
    });
    await prisma.interviewRound.deleteMany({
      where: {
        candidateId: { in: [candidate1Id, candidate2Id].filter(Boolean) },
      },
    });
    await prisma.candidate.deleteMany({
      where: { id: { in: [candidate1Id, candidate2Id].filter(Boolean) } },
    });
    if (requisitionId) {
      await prisma.jobRequisition.delete({ where: { id: requisitionId } });
    }
    await prisma.employee.deleteMany({
      where: {
        id: {
          in: [
            employeeId,
            hiringManagerId,
            otherManagerId,
            hrAdminId,
            newHireEmployeeId,
          ].filter(Boolean),
        },
      },
    });
    await prisma.designation.delete({ where: { id: designationId } });
    await prisma.department.delete({ where: { id: departmentId } });
    await prisma.company.delete({ where: { id: companyId } });
    await prisma.$disconnect();
    await app.close();
  });

  describe('POST /api/v1/onboarding/templates', () => {
    it('rejects creation by a non-HR-Admin', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/onboarding/templates')
        .set('Authorization', `Bearer ${hiringManagerToken}`)
        .send({
          name: 'AO Template',
          departmentId,
          tasks: [{ ownerRole: 'HR', description: 'x' }],
        })
        .expect(403);
    });

    it('creates a department-scoped template with tasks across roles', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/onboarding/templates')
        .set('Authorization', `Bearer ${hrAdminToken}`)
        .send({
          companyId,
          departmentId,
          name: 'AO New Hire Checklist',
          tasks: [
            {
              ownerRole: 'HR',
              description: 'Verify ID proof',
              dueOffsetDays: 0,
            },
            {
              ownerRole: 'IT',
              description: 'Provision laptop and accounts',
              dueOffsetDays: 0,
            },
            {
              ownerRole: 'MANAGER',
              description: 'Schedule welcome meeting',
              dueOffsetDays: 1,
            },
            {
              ownerRole: 'NEW_HIRE',
              description: 'Complete orientation module',
              dueOffsetDays: 2,
            },
          ],
        })
        .expect(201);

      expect(res.body.taskTemplates).toHaveLength(4);
      templateId = res.body.id;
    });
  });

  describe('GET /api/v1/onboarding/templates', () => {
    it('rejects listing by a non-HR-Admin', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/onboarding/templates')
        .set('Authorization', `Bearer ${employeeToken}`)
        .expect(403);
    });

    it('lists the active template for HR Admin', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/onboarding/templates')
        .set('Authorization', `Bearer ${hrAdminToken}`)
        .expect(200);

      expect(res.body.some((t: { id: string }) => t.id === templateId)).toBe(
        true,
      );
    });
  });

  describe('POST /api/v1/ats/requisitions', () => {
    it('rejects an unauthenticated request', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/ats/requisitions')
        .send({ title: 'X', departmentId, hiringManagerId })
        .expect(401);
    });

    it('rejects creation by a plain Employee', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/ats/requisitions')
        .set('Authorization', `Bearer ${employeeToken}`)
        .send({ title: 'X', departmentId, hiringManagerId })
        .expect(403);
    });

    it('raises a requisition as the hiring manager, pending approval', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/ats/requisitions')
        .set('Authorization', `Bearer ${hiringManagerToken}`)
        .send({
          companyId,
          title: 'Senior Backend Engineer',
          departmentId,
          hiringManagerId,
          headcount: 1,
        })
        .expect(201);

      expect(res.body.status).toBe('PENDING_APPROVAL');
      requisitionId = res.body.id;
    });
  });

  describe('Acceptance Criteria: a requisition cannot be published without recorded approval', () => {
    it('rejects publishing before approval', async () => {
      await request(app.getHttpServer())
        .post(`/api/v1/ats/requisitions/${requisitionId}/publish`)
        .set('Authorization', `Bearer ${hrAdminToken}`)
        .expect(400);
    });

    it('rejects approval by a non-HR-Admin', async () => {
      await request(app.getHttpServer())
        .post(`/api/v1/ats/requisitions/${requisitionId}/approve`)
        .set('Authorization', `Bearer ${hiringManagerToken}`)
        .expect(403);
    });

    it('approves as HR Admin, then publishes', async () => {
      const approved = await request(app.getHttpServer())
        .post(`/api/v1/ats/requisitions/${requisitionId}/approve`)
        .set('Authorization', `Bearer ${hrAdminToken}`)
        .expect(201);
      expect(approved.body.status).toBe('APPROVED');
      expect(approved.body.approvedBy).toBe(hrAdminId);

      const published = await request(app.getHttpServer())
        .post(`/api/v1/ats/requisitions/${requisitionId}/publish`)
        .set('Authorization', `Bearer ${hrAdminToken}`)
        .expect(201);
      expect(published.body.status).toBe('PUBLISHED');
    });
  });

  describe('POST /api/v1/ats/candidates (public careers apply)', () => {
    it('accepts an application with no Authorization header at all', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/ats/candidates')
        .send({
          requisitionId,
          name: 'Alex Accept',
          email: `alex.accept.${Date.now()}@example.com`,
          phone: '9000000001',
          source: 'careers-page',
        })
        .expect(201);

      expect(res.body.currentStage).toBe('APPLIED');
      expect(res.body.duplicateOfId).toBeNull();
      candidate1Id = res.body.id;
    });

    it('flags a duplicate when the same email re-applies within the lookback window', async () => {
      const first = await request(app.getHttpServer())
        .post('/api/v1/ats/candidates')
        .send({
          requisitionId,
          name: 'Casey Decline',
          email: `casey.decline.${Date.now()}@example.com`,
        })
        .expect(201);
      candidate2Id = first.body.id;

      const dup = await request(app.getHttpServer())
        .post('/api/v1/ats/candidates')
        .send({
          requisitionId,
          name: 'Casey Decline',
          email: (
            await prisma.candidate.findUniqueOrThrow({
              where: { id: candidate2Id },
            })
          ).email,
        })
        .expect(201);

      expect(dup.body.duplicateOfId).toBe(candidate2Id);

      // Clean up the throwaway duplicate row immediately — it's not used
      // anywhere else in this suite.
      await prisma.candidate.delete({ where: { id: dup.body.id } });
    });
  });

  describe("Acceptance Criteria: a candidate cannot be moved to 'Offer' without a completed interview scorecard", () => {
    it('rejects the move when no interview round is completed', async () => {
      await request(app.getHttpServer())
        .patch(`/api/v1/ats/candidates/${candidate1Id}/stage`)
        .set('Authorization', `Bearer ${hiringManagerToken}`)
        .send({ stage: 'OFFER' })
        .expect(400);
    });
  });

  describe('POST /api/v1/ats/candidates/:id/interviews + /api/v1/ats/interviews/:id/scorecard', () => {
    it('schedules an interview round for both candidates', async () => {
      const r1 = await request(app.getHttpServer())
        .post(`/api/v1/ats/candidates/${candidate1Id}/interviews`)
        .set('Authorization', `Bearer ${hiringManagerToken}`)
        .send({
          interviewerId: hiringManagerId,
          scheduledAt: '2027-02-01T10:00:00.000Z',
        })
        .expect(201);
      interviewRound1Id = r1.body.id;

      const r2 = await request(app.getHttpServer())
        .post(`/api/v1/ats/candidates/${candidate2Id}/interviews`)
        .set('Authorization', `Bearer ${hiringManagerToken}`)
        .send({
          interviewerId: hiringManagerId,
          scheduledAt: '2027-02-01T11:00:00.000Z',
        })
        .expect(201);
      interviewRound2Id = r2.body.id;
    });

    it('rejects a scorecard submission from someone other than the assigned interviewer', async () => {
      await request(app.getHttpServer())
        .post(`/api/v1/ats/interviews/${interviewRound1Id}/scorecard`)
        .set('Authorization', `Bearer ${otherManagerToken}`)
        .send({ scorecard: { rating: 4 }, recommendation: 'Hire' })
        .expect(403);
    });

    it('lets the assigned interviewer submit both scorecards', async () => {
      const s1 = await request(app.getHttpServer())
        .post(`/api/v1/ats/interviews/${interviewRound1Id}/scorecard`)
        .set('Authorization', `Bearer ${hiringManagerToken}`)
        .send({ scorecard: { rating: 5 }, recommendation: 'Strong hire' })
        .expect(201);
      expect(s1.body.completedAt).not.toBeNull();

      await request(app.getHttpServer())
        .post(`/api/v1/ats/interviews/${interviewRound2Id}/scorecard`)
        .set('Authorization', `Bearer ${hiringManagerToken}`)
        .send({ scorecard: { rating: 2 }, recommendation: 'No hire' })
        .expect(201);
    });

    it('now allows both candidates to move to Offer stage', async () => {
      const m1 = await request(app.getHttpServer())
        .patch(`/api/v1/ats/candidates/${candidate1Id}/stage`)
        .set('Authorization', `Bearer ${hiringManagerToken}`)
        .send({ stage: 'OFFER' })
        .expect(200);
      expect(m1.body.currentStage).toBe('OFFER');

      await request(app.getHttpServer())
        .patch(`/api/v1/ats/candidates/${candidate2Id}/stage`)
        .set('Authorization', `Bearer ${hiringManagerToken}`)
        .send({ stage: 'OFFER' })
        .expect(200);
    });
  });

  describe('POST /api/v1/ats/offers', () => {
    it('rejects creating an offer for a candidate not at Offer stage', async () => {
      const stray = await request(app.getHttpServer())
        .post('/api/v1/ats/candidates')
        .send({
          requisitionId,
          name: 'Not Ready',
          email: `not.ready.${Date.now()}@example.com`,
        })
        .expect(201);

      await request(app.getHttpServer())
        .post('/api/v1/ats/offers')
        .set('Authorization', `Bearer ${hrAdminToken}`)
        .send({ candidateId: stray.body.id, ctcBreakup: { base: 1000000 } })
        .expect(400);

      await prisma.candidate.delete({ where: { id: stray.body.id } });
    });

    it('creates offers for both offer-stage candidates', async () => {
      const o1 = await request(app.getHttpServer())
        .post('/api/v1/ats/offers')
        .set('Authorization', `Bearer ${hrAdminToken}`)
        .send({
          candidateId: candidate1Id,
          ctcBreakup: { base: 2000000, variable: 200000 },
        })
        .expect(201);
      expect(o1.body.status).toBe('DRAFT');
      offer1Id = o1.body.id;

      const o2 = await request(app.getHttpServer())
        .post('/api/v1/ats/offers')
        .set('Authorization', `Bearer ${hrAdminToken}`)
        .send({ candidateId: candidate2Id, ctcBreakup: { base: 1800000 } })
        .expect(201);
      offer2Id = o2.body.id;
    });
  });

  describe('Business Rule: offer approval requires sign-off from Hiring Manager + HR Admin, and sending needs both', () => {
    it("rejects a hiring-manager sign-off from someone who isn't this requisition's hiring manager", async () => {
      await request(app.getHttpServer())
        .post(`/api/v1/ats/offers/${offer1Id}/approve`)
        .set('Authorization', `Bearer ${otherManagerToken}`)
        .expect(403);
    });

    it('rejects sending until both approvals are recorded', async () => {
      await request(app.getHttpServer())
        .post(`/api/v1/ats/offers/${offer1Id}/approve`)
        .set('Authorization', `Bearer ${hiringManagerToken}`)
        .expect(201);

      await request(app.getHttpServer())
        .post(`/api/v1/ats/offers/${offer1Id}/send`)
        .set('Authorization', `Bearer ${hrAdminToken}`)
        .expect(400);
    });

    it('sends the offer once HR also approves, returning a candidate response link', async () => {
      await request(app.getHttpServer())
        .post(`/api/v1/ats/offers/${offer1Id}/approve`)
        .set('Authorization', `Bearer ${hrAdminToken}`)
        .expect(201);

      const sent = await request(app.getHttpServer())
        .post(`/api/v1/ats/offers/${offer1Id}/send`)
        .set('Authorization', `Bearer ${hrAdminToken}`)
        .expect(201);

      expect(sent.body.offer.status).toBe('SENT');
      expect(typeof sent.body.responseLink).toBe('string');
      offerResponseToken = sent.body.responseLink;

      // Bring offer #2 (the decline path) fully to SENT the same way.
      await request(app.getHttpServer())
        .post(`/api/v1/ats/offers/${offer2Id}/approve`)
        .set('Authorization', `Bearer ${hiringManagerToken}`)
        .expect(201);
      await request(app.getHttpServer())
        .post(`/api/v1/ats/offers/${offer2Id}/approve`)
        .set('Authorization', `Bearer ${hrAdminToken}`)
        .expect(201);
      const sent2 = await request(app.getHttpServer())
        .post(`/api/v1/ats/offers/${offer2Id}/send`)
        .set('Authorization', `Bearer ${hrAdminToken}`)
        .expect(201);
      offer2ResponseToken = sent2.body.responseLink;
    });
  });

  describe('GET /api/v1/ats/offers/portal + POST /api/v1/ats/offers/respond (public)', () => {
    it('shows the offer to the candidate with no Authorization header', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/ats/offers/portal')
        .query({ token: offerResponseToken })
        .expect(200);

      expect(res.body.status).toBe('SENT');
      expect(res.body.candidateName).toBe('Alex Accept');
    });

    it('rejects a garbage token', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/ats/offers/portal')
        .query({ token: 'not-a-real-token' })
        .expect(401);
    });

    it("declining candidate #2's offer marks it DECLINED and rejects the candidate, with no Employee created", async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/ats/offers/respond')
        .send({ token: offer2ResponseToken, decision: 'DECLINE' })
        .expect(201);
      expect(res.body.status).toBe('DECLINED');

      const candidate2 = await prisma.candidate.findUniqueOrThrow({
        where: { id: candidate2Id },
      });
      expect(candidate2.currentStage).toBe('REJECTED');
    });

    it("accepting candidate #1's offer creates a Preboarding Employee with zero re-entry, and auto-starts onboarding", async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/ats/offers/respond')
        .send({ token: offerResponseToken, decision: 'ACCEPT' })
        .expect(201);

      expect(res.body.status).toBe('ACCEPTED');
      expect(res.body.employeeId).toBeDefined();
      expect(typeof res.body.preboardingLink).toBe('string');
      newHireEmployeeId = res.body.employeeId;
      preboardingToken = res.body.preboardingLink;

      const employee = await prisma.employee.findUniqueOrThrow({
        where: { id: newHireEmployeeId },
      });
      expect(employee.status).toBe('PREBOARDING');
      expect(employee.firstName).toBe('Alex');
      expect(employee.lastName).toBe('Accept');
      expect(employee.reportingManagerId).toBe(hiringManagerId);

      const candidate1 = await prisma.candidate.findUniqueOrThrow({
        where: { id: candidate1Id },
      });
      expect(candidate1.currentStage).toBe('HIRED');
    });

    it('rejects responding to an offer that has already been decided', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/ats/offers/respond')
        .send({ token: offerResponseToken, decision: 'ACCEPT' })
        .expect(400);
    });
  });

  describe('GET /api/v1/ats/requisitions/:id/analytics', () => {
    it('reports candidates by stage and a computed time-to-fill', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/ats/requisitions/${requisitionId}/analytics`)
        .set('Authorization', `Bearer ${hrAdminToken}`)
        .expect(200);

      expect(res.body.totalCandidates).toBeGreaterThanOrEqual(2);
      expect(res.body.byStage.HIRED).toBe(1);
      expect(res.body.byStage.REJECTED).toBe(1);
      expect(res.body.timeToFillDays).not.toBeNull();
    });
  });

  describe('Integration point: an accepted offer auto-creates the onboarding checklist', () => {
    it("shows the new hire's checklist snapshotted from the department template", async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/onboarding/${newHireEmployeeId}/progress`)
        .set('Authorization', `Bearer ${hrAdminToken}`)
        .expect(200);

      expect(res.body.checklist.templateId).toBe(templateId);
      expect(res.body.checklist.tasks).toHaveLength(4);
      expect(res.body.completionPercent).toBe(0);
    });

    it('lists the new checklist among active checklists for HR Admin', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/onboarding/checklists')
        .set('Authorization', `Bearer ${hrAdminToken}`)
        .expect(200);

      expect(
        res.body.some(
          (c: { employeeId: string }) => c.employeeId === newHireEmployeeId,
        ),
      ).toBe(true);
    });
  });

  describe('Access control: only the right role can complete a staff-owned checklist task', () => {
    it('rejects activation while mandatory preboarding items are still missing', async () => {
      await request(app.getHttpServer())
        .post(`/api/v1/onboarding/${newHireEmployeeId}/activate`)
        .set('Authorization', `Bearer ${hrAdminToken}`)
        .expect(400);
    });

    it('rejects a non-manager completing the manager-owned task', async () => {
      const progress = await request(app.getHttpServer())
        .get(`/api/v1/onboarding/${newHireEmployeeId}/progress`)
        .set('Authorization', `Bearer ${hrAdminToken}`)
        .expect(200);
      const managerTask = progress.body.checklist.tasks.find(
        (t: { ownerRole: string }) => t.ownerRole === 'MANAGER',
      );

      await request(app.getHttpServer())
        .post(`/api/v1/onboarding/tasks/${managerTask.id}/complete`)
        .set('Authorization', `Bearer ${employeeToken}`)
        .expect(400);
    });

    it('rejects completing a new-hire task through the staff endpoint', async () => {
      const progress = await request(app.getHttpServer())
        .get(`/api/v1/onboarding/${newHireEmployeeId}/progress`)
        .set('Authorization', `Bearer ${hrAdminToken}`)
        .expect(200);
      const newHireTask = progress.body.checklist.tasks.find(
        (t: { ownerRole: string }) => t.ownerRole === 'NEW_HIRE',
      );

      await request(app.getHttpServer())
        .post(`/api/v1/onboarding/tasks/${newHireTask.id}/complete`)
        .set('Authorization', `Bearer ${hrAdminToken}`)
        .expect(400);
    });

    it('lets HR complete the HR/IT tasks and the hiring manager complete the manager task', async () => {
      const progress = await request(app.getHttpServer())
        .get(`/api/v1/onboarding/${newHireEmployeeId}/progress`)
        .set('Authorization', `Bearer ${hrAdminToken}`)
        .expect(200);
      const tasks: Array<{ id: string; ownerRole: string }> =
        progress.body.checklist.tasks;

      const hrTask = tasks.find((t) => t.ownerRole === 'HR')!;
      const itTask = tasks.find((t) => t.ownerRole === 'IT')!;
      const managerTask = tasks.find((t) => t.ownerRole === 'MANAGER')!;

      await request(app.getHttpServer())
        .post(`/api/v1/onboarding/tasks/${hrTask.id}/complete`)
        .set('Authorization', `Bearer ${hrAdminToken}`)
        .expect(201);
      await request(app.getHttpServer())
        .post(`/api/v1/onboarding/tasks/${itTask.id}/complete`)
        .set('Authorization', `Bearer ${hrAdminToken}`)
        .expect(201);
      await request(app.getHttpServer())
        .post(`/api/v1/onboarding/tasks/${managerTask.id}/complete`)
        .set('Authorization', `Bearer ${hiringManagerToken}`)
        .expect(201);

      const after = await request(app.getHttpServer())
        .get(`/api/v1/onboarding/${newHireEmployeeId}/progress`)
        .set('Authorization', `Bearer ${hrAdminToken}`)
        .expect(200);
      expect(after.body.completionPercent).toBe(75);
      expect(after.body.checklist.status).toBe('IN_PROGRESS');
    });
  });

  describe('Preboarding portal (public, magic-link gated)', () => {
    it("shows the new hire's own progress via their portal link with no Authorization header", async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/onboarding/portal/progress')
        .query({ token: preboardingToken })
        .expect(200);

      expect(res.body.checklist.employeeId).toBe(newHireEmployeeId);
    });

    it('completes the New Hire task through the portal, finishing the checklist', async () => {
      const progress = await request(app.getHttpServer())
        .get('/api/v1/onboarding/portal/progress')
        .query({ token: preboardingToken })
        .expect(200);
      const newHireTask = progress.body.checklist.tasks.find(
        (t: { ownerRole: string }) => t.ownerRole === 'NEW_HIRE',
      );

      await request(app.getHttpServer())
        .post(`/api/v1/onboarding/portal/tasks/${newHireTask.id}/complete`)
        .send({ token: preboardingToken })
        .expect(201);

      const after = await request(app.getHttpServer())
        .get('/api/v1/onboarding/portal/progress')
        .query({ token: preboardingToken })
        .expect(200);
      expect(after.body.completionPercent).toBe(100);
      expect(after.body.checklist.status).toBe('COMPLETED');
    });

    it('rejects completing a portal task with an invalid or expired token', async () => {
      const progress = await request(app.getHttpServer())
        .get('/api/v1/onboarding/portal/progress')
        .query({ token: preboardingToken })
        .expect(200);
      const anyTaskId = progress.body.checklist.tasks[0].id;

      await request(app.getHttpServer())
        .post(`/api/v1/onboarding/portal/tasks/${anyTaskId}/complete`)
        .send({ token: 'garbage' })
        .expect(401);

      await request(app.getHttpServer())
        .get('/api/v1/onboarding/portal/progress')
        .query({ token: 'garbage' })
        .expect(401);
    });
  });

  describe("Business Rule: status cannot move from 'Preboarding' to 'Active' until all mandatory items are complete", () => {
    it('rejects activation while mandatory preboarding documents are missing', async () => {
      await request(app.getHttpServer())
        .post(`/api/v1/onboarding/${newHireEmployeeId}/activate`)
        .set('Authorization', `Bearer ${hrAdminToken}`)
        .expect(400);
    });

    it('submits all mandatory preboarding documents through the public portal', async () => {
      const fields = [
        'ID_PROOF',
        'EDUCATION_CERTIFICATE',
        'BANK_DETAILS',
        'BACKGROUND_CHECK_CONSENT',
      ];
      for (const fieldType of fields) {
        await request(app.getHttpServer())
          .post('/api/v1/onboarding/preboard/submit')
          .send({
            token: preboardingToken,
            fieldType,
            valueRef: `doc-ref-${fieldType}`,
          })
          .expect(201);
      }
    });

    it('resubmitting the same field updates the existing row instead of duplicating it', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/onboarding/preboard/submit')
        .send({
          token: preboardingToken,
          fieldType: 'ID_PROOF',
          valueRef: 'doc-ref-ID_PROOF-v2',
        })
        .expect(201);

      const submissions = await prisma.preboardingSubmission.findMany({
        where: { employeeId: newHireEmployeeId, fieldType: 'ID_PROOF' },
      });
      expect(submissions).toHaveLength(1);
      expect(submissions[0].valueRef).toBe('doc-ref-ID_PROOF-v2');
    });

    it('activates the employee once every mandatory field is on file', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/onboarding/${newHireEmployeeId}/activate`)
        .set('Authorization', `Bearer ${hrAdminToken}`)
        .expect(201);
      expect(res.body.status).toBe('ACTIVE_PROBATION');

      const employee = await prisma.employee.findUniqueOrThrow({
        where: { id: newHireEmployeeId },
      });
      expect(employee.status).toBe('ACTIVE_PROBATION');

      const history = await prisma.employeeHistory.findFirst({
        where: { employeeId: newHireEmployeeId, fieldChanged: 'status' },
      });
      expect(history?.oldValue).toBe('PREBOARDING');
      expect(history?.newValue).toBe('ACTIVE_PROBATION');
    });

    it('rejects re-activating an employee no longer in Preboarding', async () => {
      await request(app.getHttpServer())
        .post(`/api/v1/onboarding/${newHireEmployeeId}/activate`)
        .set('Authorization', `Bearer ${hrAdminToken}`)
        .expect(400);
    });
  });
});
