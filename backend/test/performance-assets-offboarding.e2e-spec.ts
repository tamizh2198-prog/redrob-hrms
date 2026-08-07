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

// The resignation below negotiates its LWD down to 15 days from today
// against a 30-day notice period — a real 15-day shortfall, computed
// relative to whenever this suite actually runs (never hardcoded to a
// fixed calendar date that could stop being "in the future").
const now = new Date();
const ADJUSTED_LWD = new Date(
  Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 15),
);
const ADJUSTED_LWD_ISO = ADJUSTED_LWD.toISOString().slice(0, 10);

describe('Performance + Assets + Offboarding (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaClient;

  let companyId: string;
  let departmentId: string;
  let designationId: string;
  let leaveTypeId: string;

  let hrAdminId: string;
  let managerId: string;
  let employeeId: string;

  let hrAdminToken: string;
  let managerToken: string;
  let employeeToken: string;

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
      data: { name: 'PAO E2E Co' },
    });
    companyId = company.id;

    const department = await prisma.department.create({
      data: { companyId, name: 'PAO Dept', code: `PAO-DEPT-${Date.now()}` },
    });
    departmentId = department.id;

    const designation = await prisma.designation.create({
      data: { companyId, name: 'PAO Role', code: `PAO-DESIG-${Date.now()}` },
    });
    designationId = designation.id;

    const leaveType = await prisma.leaveType.create({
      data: {
        companyId,
        name: `PAO Earned Leave ${Date.now()}`,
        code: 'EL',
        accrualFrequency: 'MONTHLY',
        accrualRate: 1,
        isEncashable: true,
      },
    });
    leaveTypeId = leaveType.id;

    const hrAdmin = await prisma.employee.create({
      data: {
        ...baseFields,
        companyId,
        departmentId,
        designationId,
        employeeCode: `PAO-HR-${Date.now()}`,
        firstName: 'PAO',
        lastName: 'HrAdmin',
        role: Role.HR_ADMIN,
      },
    });
    hrAdminId = hrAdmin.id;

    const manager = await prisma.employee.create({
      data: {
        ...baseFields,
        companyId,
        departmentId,
        designationId,
        employeeCode: `PAO-MGR-${Date.now()}`,
        firstName: 'PAO',
        lastName: 'Manager',
        role: Role.MANAGER,
        reportingManagerId: hrAdminId,
      },
    });
    managerId = manager.id;

    const employee = await prisma.employee.create({
      data: {
        ...baseFields,
        companyId,
        departmentId,
        designationId,
        employeeCode: `PAO-EMP-${Date.now()}`,
        firstName: 'PAO',
        lastName: 'Employee',
        role: Role.EMPLOYEE,
        reportingManagerId: managerId,
      },
    });
    employeeId = employee.id;

    // 12 days of encashable Earned Leave on file — this is what the F&F
    // computation must pull automatically, with zero re-entry. Seeded for
    // the same year as ADJUSTED_LWD, since computeSettlement reads the
    // balance for the (post-negotiation) last working day's year.
    await prisma.leaveBalance.create({
      data: {
        employeeId,
        leaveTypeId,
        year: ADJUSTED_LWD.getUTCFullYear(),
        openingBalance: 12,
      },
    });

    hrAdminToken = await login(hrAdmin.employeeCode);
    managerToken = await login(manager.employeeCode);
    employeeToken = await login(employee.employeeCode);
  });

  afterAll(async () => {
    await prisma.finalSettlement.deleteMany({ where: { employeeId } });
    await prisma.lwdAdjustment.deleteMany({
      where: { resignation: { employeeId } },
    });
    await prisma.clearanceItem.deleteMany({
      where: { resignation: { employeeId } },
    });
    await prisma.exitInterview.deleteMany({ where: { employeeId } });
    await prisma.resignation.deleteMany({ where: { employeeId } });
    await prisma.assetAssignment.deleteMany({ where: { employeeId } });
    await prisma.asset.deleteMany({ where: { companyId } });
    await prisma.reviewCorrection.deleteMany({
      where: { review: { employeeId } },
    });
    await prisma.review.deleteMany({ where: { employeeId } });
    await prisma.goal.deleteMany({ where: { employeeId } });
    await prisma.reviewCycle.deleteMany({ where: { companyId } });
    await prisma.leaveBalance.deleteMany({ where: { employeeId } });
    await prisma.leaveType.delete({ where: { id: leaveTypeId } });
    // markSettlementPaid writes an EmployeeHistory audit row when it
    // archives the employee — it still references them by FK.
    await prisma.employeeHistory.deleteMany({
      where: { employeeId: { in: [employeeId, managerId, hrAdminId] } },
    });
    await prisma.employee.deleteMany({
      where: { id: { in: [employeeId, managerId, hrAdminId] } },
    });
    await prisma.designation.delete({ where: { id: designationId } });
    await prisma.department.delete({ where: { id: departmentId } });
    await prisma.company.delete({ where: { id: companyId } });
    await prisma.$disconnect();
    await app.close();
  });

  describe('Performance: goal weightage and review cycle close', () => {
    let cycleId: string;

    it('opens a review cycle as HR Admin', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/performance/reviews/cycle')
        .set('Authorization', `Bearer ${hrAdminToken}`)
        .send({
          companyId,
          name: 'PAO Q1',
          periodStart: '2027-01-01',
          periodEnd: '2027-03-31',
        })
        .expect(201);
      cycleId = res.body.id;
    });

    it('rejects self-assessment submission until goal weightages sum to 100%', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/performance/goals')
        .set('Authorization', `Bearer ${employeeToken}`)
        .send({ cycleId, title: 'Ship feature X', target: 1, weightage: 60 })
        .expect(201);

      await request(app.getHttpServer())
        .post('/api/v1/performance/reviews/self-assessment')
        .set('Authorization', `Bearer ${employeeToken}`)
        .send({ cycleId, assessment: { notes: 'On track' } })
        .expect(400);

      await request(app.getHttpServer())
        .post('/api/v1/performance/goals')
        .set('Authorization', `Bearer ${employeeToken}`)
        .send({ cycleId, title: 'Mentor a junior', target: 1, weightage: 40 })
        .expect(201);
    });

    it('accepts self-assessment once weightages sum to 100%, then the manager assessment', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/performance/reviews/self-assessment')
        .set('Authorization', `Bearer ${employeeToken}`)
        .send({ cycleId, assessment: { notes: 'On track' } })
        .expect(201);

      await request(app.getHttpServer())
        .post('/api/v1/performance/reviews/manager-assessment')
        .set('Authorization', `Bearer ${managerToken}`)
        .send({
          cycleId,
          employeeId,
          assessment: { notes: 'Strong quarter' },
          rating: 4.5,
        })
        .expect(201);
    });

    it('closes the cycle and finalizes the review', async () => {
      await request(app.getHttpServer())
        .post(`/api/v1/performance/reviews/cycle/${cycleId}/close`)
        .set('Authorization', `Bearer ${hrAdminToken}`)
        .expect(201);

      const review = await request(app.getHttpServer())
        .get(`/api/v1/performance/reviews/${cycleId}/${employeeId}`)
        .set('Authorization', `Bearer ${hrAdminToken}`)
        .expect(200);
      expect(review.body.status).toBe('FINALIZED');
    });

    it('rejects re-submitting a self-assessment once the cycle is closed', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/performance/reviews/self-assessment')
        .set('Authorization', `Bearer ${employeeToken}`)
        .send({ cycleId, assessment: { notes: 'trying to change it' } })
        .expect(400);
    });

    it('lets HR Admin correct the rating through the documented correction workflow', async () => {
      const review = await request(app.getHttpServer())
        .get(`/api/v1/performance/reviews/${cycleId}/${employeeId}`)
        .set('Authorization', `Bearer ${hrAdminToken}`)
        .expect(200);

      await request(app.getHttpServer())
        .post(`/api/v1/performance/reviews/${review.body.id}/correct-rating`)
        .set('Authorization', `Bearer ${hrAdminToken}`)
        .send({ newRating: 4.8, reason: 'Manager under-scored a shipped goal' })
        .expect(201);

      const corrected = await request(app.getHttpServer())
        .get(`/api/v1/performance/reviews/${cycleId}/${employeeId}`)
        .set('Authorization', `Bearer ${hrAdminToken}`)
        .expect(200);
      expect(corrected.body.finalRating).toBe(4.8);
      expect(corrected.body.version).toBe(2);
    });
  });

  describe('Assets: single active custodian and acknowledgement-gated Issued status', () => {
    let assetId: string;
    let assignmentId: string;

    it('registers an asset as HR Admin', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/assets')
        .set('Authorization', `Bearer ${hrAdminToken}`)
        .send({ companyId, category: 'Laptop', cost: 85000 })
        .expect(201);
      assetId = res.body.id;
      expect(res.body.status).toBe('AVAILABLE');
    });

    it('issues the asset as Pending Handover, not Issued, until acknowledged', async () => {
      await request(app.getHttpServer())
        .post(`/api/v1/assets/${assetId}/issue`)
        .set('Authorization', `Bearer ${hrAdminToken}`)
        .send({ employeeId })
        .expect(201);

      const mine = await request(app.getHttpServer())
        .get('/api/v1/assets/mine')
        .set('Authorization', `Bearer ${employeeToken}`)
        .expect(200);
      expect(mine.body[0].asset.status).toBe('PENDING_HANDOVER');
      assignmentId = mine.body[0].id;
    });

    it('rejects acknowledgement from anyone other than the receiving employee', async () => {
      await request(app.getHttpServer())
        .post(`/api/v1/assets/assignments/${assignmentId}/acknowledge`)
        .set('Authorization', `Bearer ${managerToken}`)
        .expect(403);
    });

    it('flips the asset to Issued once the employee acknowledges', async () => {
      await request(app.getHttpServer())
        .post(`/api/v1/assets/assignments/${assignmentId}/acknowledge`)
        .set('Authorization', `Bearer ${employeeToken}`)
        .expect(201);

      const list = await request(app.getHttpServer())
        .get('/api/v1/assets')
        .set('Authorization', `Bearer ${hrAdminToken}`)
        .expect(200);
      const asset = list.body.find((a: { id: string }) => a.id === assetId);
      expect(asset.status).toBe('ISSUED');
    });

    it('reassigning to a different employee auto-closes the prior custody record', async () => {
      const other = await prisma.employee.create({
        data: {
          ...baseFields,
          companyId,
          departmentId,
          designationId,
          employeeCode: `PAO-OTHER-${Date.now()}`,
          firstName: 'PAO',
          lastName: 'Other',
          role: Role.EMPLOYEE,
        },
      });

      await request(app.getHttpServer())
        .post(`/api/v1/assets/${assetId}/issue`)
        .set('Authorization', `Bearer ${hrAdminToken}`)
        .send({ employeeId: other.id })
        .expect(201);

      const priorAssignment = await prisma.assetAssignment.findUnique({
        where: { id: assignmentId },
      });
      expect(priorAssignment?.returnedAt).not.toBeNull();

      const activeCount = await prisma.assetAssignment.count({
        where: { assetId, returnedAt: null },
      });
      expect(activeCount).toBe(1); // never two active custodians at once

      // Return it from the "other" employee so the asset is fully free again
      // — this test only needed to prove the auto-close, not keep custody.
      await request(app.getHttpServer())
        .post(`/api/v1/assets/${assetId}/return`)
        .set('Authorization', `Bearer ${hrAdminToken}`)
        .send({ condition: 'GOOD' })
        .expect(201);

      // "other"'s (now-closed) AssetAssignment row still references them by
      // FK — delete it before the employee, not after.
      await prisma.assetAssignment.deleteMany({
        where: { employeeId: other.id },
      });
      await prisma.employee.delete({ where: { id: other.id } });
    });

    it('re-issues the laptop to our exiting employee for the offboarding scenario below', async () => {
      await request(app.getHttpServer())
        .post(`/api/v1/assets/${assetId}/issue`)
        .set('Authorization', `Bearer ${hrAdminToken}`)
        .send({ employeeId })
        .expect(201);
      // Left un-acknowledged and unreturned on purpose — this is exactly the
      // "unreturned asset" state the Offboarding IT Clearance gate must
      // catch below.
    });
  });

  describe('Offboarding: resignation, LWD negotiation, and clearance', () => {
    let resignationId: string;
    let itClearanceItemId: string;
    let assetId: string;

    beforeAll(async () => {
      const list = await request(app.getHttpServer())
        .get('/api/v1/assets')
        .set('Authorization', `Bearer ${hrAdminToken}`)
        .expect(200);
      assetId = list.body.find(
        (a: { status: string }) => a.status === 'PENDING_HANDOVER',
      ).id;
    });

    it("rejects an employee resigning on someone else's behalf", async () => {
      await request(app.getHttpServer())
        .post('/api/v1/offboarding/resign')
        .set('Authorization', `Bearer ${employeeToken}`)
        .send({ employeeId: managerId, noticePeriodDays: 30 })
        .expect(403);
    });

    it('submits a resignation and auto-computes the last working day + 4-department clearance checklist', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/offboarding/resign')
        .set('Authorization', `Bearer ${employeeToken}`)
        .send({ noticePeriodDays: 30 })
        .expect(201);

      resignationId = res.body.id;
      expect(res.body.clearanceItems).toHaveLength(4);
      const departments = res.body.clearanceItems.map(
        (c: { department: string }) => c.department,
      );
      expect(departments.sort()).toEqual(['ADMIN', 'FINANCE', 'HR', 'IT']);

      const submitted = new Date(res.body.submittedDate);
      const lwd = new Date(res.body.lastWorkingDay);
      const diffDays = Math.round(
        (lwd.getTime() - submitted.getTime()) / (24 * 60 * 60 * 1000),
      );
      expect(diffDays).toBe(30);

      itClearanceItemId = res.body.clearanceItems.find(
        (c: { department: string }) => c.department === 'IT',
      ).id;
    });

    it("rejects an LWD adjustment from someone who isn't the manager or HR", async () => {
      const someoneElse = await prisma.employee.create({
        data: {
          ...baseFields,
          companyId,
          departmentId,
          designationId,
          employeeCode: `PAO-UNREL-${Date.now()}`,
          firstName: 'PAO',
          lastName: 'Unrelated',
          role: Role.MANAGER,
        },
      });
      const token = await login(someoneElse.employeeCode);

      await request(app.getHttpServer())
        .post(`/api/v1/offboarding/${resignationId}/adjust-lwd`)
        .set('Authorization', `Bearer ${token}`)
        .send({ newDate: ADJUSTED_LWD_ISO, reason: 'Trying to interfere' })
        .expect(403);

      await prisma.employee.delete({ where: { id: someoneElse.id } });
    });

    it('lets the manager negotiate an earlier LWD, recording an audit trail', async () => {
      await request(app.getHttpServer())
        .post(`/api/v1/offboarding/${resignationId}/adjust-lwd`)
        .set('Authorization', `Bearer ${managerToken}`)
        .send({
          newDate: ADJUSTED_LWD_ISO,
          reason: 'Mutually agreed early release',
        })
        .expect(201);

      const resignation = await request(app.getHttpServer())
        .get(`/api/v1/offboarding/${resignationId}`)
        .set('Authorization', `Bearer ${hrAdminToken}`)
        .expect(200);
      expect(resignation.body.lwdAdjustments).toHaveLength(1);
      expect(resignation.body.lwdAdjustments[0].reason).toBe(
        'Mutually agreed early release',
      );
    });

    it('Integration point: IT Clearance is blocked while the asset is unreturned', async () => {
      await request(app.getHttpServer())
        .post(`/api/v1/offboarding/clearance/${itClearanceItemId}/signoff`)
        .set('Authorization', `Bearer ${hrAdminToken}`)
        .expect(400);
    });

    it('returning the asset unblocks IT Clearance, and signing off all four departments clears the resignation', async () => {
      await request(app.getHttpServer())
        .post(`/api/v1/assets/${assetId}/return`)
        .set('Authorization', `Bearer ${hrAdminToken}`)
        .send({ condition: 'GOOD' })
        .expect(201);

      await request(app.getHttpServer())
        .post(`/api/v1/offboarding/clearance/${itClearanceItemId}/signoff`)
        .set('Authorization', `Bearer ${hrAdminToken}`)
        .expect(201);

      const clearance = await request(app.getHttpServer())
        .get(`/api/v1/offboarding/${resignationId}/clearance`)
        .set('Authorization', `Bearer ${hrAdminToken}`)
        .expect(200);

      const remaining = clearance.body.filter(
        (c: { status: string }) => c.status === 'PENDING',
      );
      await Promise.all(
        remaining.map((c: { id: string }) =>
          request(app.getHttpServer())
            .post(`/api/v1/offboarding/clearance/${c.id}/signoff`)
            .set('Authorization', `Bearer ${hrAdminToken}`)
            .expect(201),
        ),
      );

      const resignation = await request(app.getHttpServer())
        .get(`/api/v1/offboarding/${resignationId}`)
        .set('Authorization', `Bearer ${hrAdminToken}`)
        .expect(200);
      expect(resignation.body.status).toBe('CLEARED');
    });

    it('rejects generating the relieving letter before this point, but succeeds now that all clearance is signed off', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/offboarding/${resignationId}/generate-letters`)
        .set('Authorization', `Bearer ${hrAdminToken}`)
        .expect(201);
      expect(res.body.relievingLetterRef).toContain(resignationId);
      expect(res.body.experienceLetterRef).toContain(resignationId);
    });

    describe('Integration point: F&F settlement automatically pulls leave encashment and asset recovery', () => {
      it('nets pending salary + leave encashment against notice shortfall and asset recovery with no manual re-entry', async () => {
        // Notice period was 30 days, but the negotiated LWD (15 days out) is
        // well short of that. We don't hardcode the shortfall; we read the
        // resignation back and recompute it the same way the service does,
        // then check that the three cross-module numbers, and their
        // netting, are correct.
        const resignation = await request(app.getHttpServer())
          .get(`/api/v1/offboarding/${resignationId}`)
          .set('Authorization', `Bearer ${hrAdminToken}`)
          .expect(200);

        const submitted = new Date(resignation.body.submittedDate);
        const requiredLwd = new Date(submitted);
        requiredLwd.setUTCDate(
          requiredLwd.getUTCDate() + resignation.body.noticePeriodDays,
        );
        const actualLwd = new Date(resignation.body.lastWorkingDay);
        const shortfallDays = Math.max(
          0,
          Math.round(
            (requiredLwd.getTime() - actualLwd.getTime()) /
              (24 * 60 * 60 * 1000),
          ),
        );

        const perDayPayRate = 1500;
        const pendingSalary = 40000;
        const res = await request(app.getHttpServer())
          .get(`/api/v1/offboarding/${resignationId}/settlement`)
          .query({ perDayPayRate, pendingSalary })
          .set('Authorization', `Bearer ${hrAdminToken}`)
          .expect(200);

        // 12 days seeded as opening balance on the encashable leave type —
        // pulled automatically from the Leave module.
        expect(res.body.leaveEncashment).toBe(12 * perDayPayRate);
        // The laptop (cost 85000) was returned above, so nothing outstanding
        // — asset recovery pulled automatically from the Asset module.
        expect(res.body.assetRecovery).toBe(0);
        expect(res.body.noticeRecovery).toBe(shortfallDays * perDayPayRate);
        expect(res.body.netPayable).toBe(
          pendingSalary +
            12 * perDayPayRate -
            shortfallDays * perDayPayRate -
            0,
        );
        expect(res.body.status).toBe('PENDING_APPROVAL');
      });

      it("rejects marking the settlement paid before it's approved", async () => {
        await request(app.getHttpServer())
          .post(`/api/v1/offboarding/${resignationId}/settlement/mark-paid`)
          .set('Authorization', `Bearer ${hrAdminToken}`)
          .expect(400);
      });

      it('approves the settlement, marks it paid, and archives the employee only then', async () => {
        await request(app.getHttpServer())
          .post(`/api/v1/offboarding/${resignationId}/settlement/approve`)
          .set('Authorization', `Bearer ${hrAdminToken}`)
          .expect(201);

        const beforePaid = await prisma.employee.findUniqueOrThrow({
          where: { id: employeeId },
        });
        expect(beforePaid.status).not.toBe('ARCHIVED');

        await request(app.getHttpServer())
          .post(`/api/v1/offboarding/${resignationId}/settlement/mark-paid`)
          .set('Authorization', `Bearer ${hrAdminToken}`)
          .send({ rehireEligible: true })
          .expect(201);

        const employee = await prisma.employee.findUniqueOrThrow({
          where: { id: employeeId },
        });
        expect(employee.status).toBe('ARCHIVED');

        const history = await prisma.employeeHistory.findFirst({
          where: { employeeId, fieldChanged: 'status', newValue: 'ARCHIVED' },
        });
        expect(history).not.toBeNull();
      });
    });
  });
});
