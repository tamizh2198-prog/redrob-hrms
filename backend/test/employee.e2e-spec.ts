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

describe('Employee Management (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaClient;

  let companyId: string;
  let departmentId: string;
  let designationId: string;

  let superAdminId: string;
  let hrAdminId: string;
  let managerId: string;
  let employeeId: string;
  let otherEmployeeId: string;

  let hrAdminToken: string;
  let managerToken: string;
  let employeeToken: string;

  const baseFields = {
    dob: new Date('1990-01-01'),
    gender: Gender.PREFER_NOT_TO_SAY,
    dateOfJoining: new Date('2024-01-01'),
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
      data: { name: 'E2E Test Co' },
    });
    companyId = company.id;

    const department = await prisma.department.create({
      data: { companyId, name: 'E2E Dept', code: `E2E-DEPT-${Date.now()}` },
    });
    departmentId = department.id;

    const designation = await prisma.designation.create({
      data: { companyId, name: 'E2E Role', code: `E2E-DESIG-${Date.now()}` },
    });
    designationId = designation.id;

    const superAdmin = await prisma.employee.create({
      data: {
        ...baseFields,
        companyId,
        departmentId,
        designationId,
        employeeCode: `E2E-SUPER-${Date.now()}`,
        firstName: 'E2E',
        lastName: 'SuperAdmin',
        role: Role.SUPER_ADMIN,
      },
    });
    superAdminId = superAdmin.id;

    const hrAdmin = await prisma.employee.create({
      data: {
        ...baseFields,
        companyId,
        departmentId,
        designationId,
        employeeCode: `E2E-HR-${Date.now()}`,
        firstName: 'E2E',
        lastName: 'HrAdmin',
        role: Role.HR_ADMIN,
        reportingManagerId: superAdminId,
      },
    });
    hrAdminId = hrAdmin.id;

    const manager = await prisma.employee.create({
      data: {
        ...baseFields,
        companyId,
        departmentId,
        designationId,
        employeeCode: `E2E-MGR-${Date.now()}`,
        firstName: 'E2E',
        lastName: 'Manager',
        role: Role.MANAGER,
        reportingManagerId: superAdminId,
      },
    });
    managerId = manager.id;

    const employee = await prisma.employee.create({
      data: {
        ...baseFields,
        companyId,
        departmentId,
        designationId,
        employeeCode: `E2E-EMP-${Date.now()}`,
        firstName: 'E2E',
        lastName: 'Employee',
        role: Role.EMPLOYEE,
        reportingManagerId: managerId,
        phone: '1000000000',
      },
    });
    employeeId = employee.id;

    const otherEmployee = await prisma.employee.create({
      data: {
        ...baseFields,
        companyId,
        departmentId,
        designationId,
        employeeCode: `E2E-OTHER-${Date.now()}`,
        firstName: 'E2E',
        lastName: 'Unrelated',
        role: Role.EMPLOYEE,
        reportingManagerId: superAdminId,
      },
    });
    otherEmployeeId = otherEmployee.id;

    hrAdminToken = await login(hrAdmin.employeeCode);
    managerToken = await login(manager.employeeCode);
    employeeToken = await login(employee.employeeCode);
  });

  afterAll(async () => {
    await prisma.profileChangeRequest.deleteMany({
      where: { employeeId: { in: [employeeId, otherEmployeeId] } },
    });
    await prisma.employeeHistory.deleteMany({
      where: {
        employeeId: { in: [employeeId, otherEmployeeId, managerId, hrAdminId] },
      },
    });
    await prisma.employee.deleteMany({
      where: {
        id: {
          in: [employeeId, otherEmployeeId, managerId, hrAdminId, superAdminId],
        },
      },
    });
    await prisma.designation.delete({ where: { id: designationId } });
    await prisma.department.delete({ where: { id: departmentId } });
    await prisma.company.delete({ where: { id: companyId } });
    await prisma.$disconnect();
    await app.close();
  });

  describe('POST /api/v1/employees', () => {
    it('creates an employee as HR Admin (happy path)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/employees')
        .set('Authorization', `Bearer ${hrAdminToken}`)
        .send({
          companyId,
          departmentId,
          designationId,
          reportingManagerId: managerId,
          firstName: 'New',
          lastName: 'Hire',
          status: EmployeeStatus.ACTIVE_PROBATION,
          dob: '1990-01-01',
          gender: Gender.PREFER_NOT_TO_SAY,
          dateOfJoining: '2024-01-01',
          pan: 'ABCDE1234F',
          bankAccountNumber: '000123456789',
          emergencyContactName: 'Emergency Contact',
          emergencyContactPhone: '9999999999',
        })
        .expect(201);

      expect(res.body.employeeCode).toMatch(/^EMP-\d{4}-\d{4}$/);

      await prisma.employee.delete({ where: { id: res.body.id } });
    });

    it('rejects creation by a non-HR-Admin role', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/employees')
        .set('Authorization', `Bearer ${employeeToken}`)
        .send({ firstName: 'New', lastName: 'Hire' })
        .expect(403);
    });

    it('rejects creation missing mandatory fields for Active status', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/employees')
        .set('Authorization', `Bearer ${hrAdminToken}`)
        .send({
          firstName: 'Incomplete',
          lastName: 'Record',
          status: EmployeeStatus.ACTIVE,
        })
        .expect(400);
    });

    it('rejects an unauthenticated request', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/employees')
        .send({ firstName: 'New', lastName: 'Hire' })
        .expect(401);
    });
  });

  describe('GET /api/v1/employees', () => {
    it('returns a paginated, masked list', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/employees')
        .set('Authorization', `Bearer ${managerToken}`)
        .expect(200);

      expect(res.body).toHaveProperty('items');
      expect(res.body).toHaveProperty('total');
      const target = res.body.items.find(
        (e: { id: string }) => e.id === employeeId,
      );
      expect(target.pan).not.toBe(baseFields.pan);
      expect(target.pan).toContain('****');
    });

    it('filters by department', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/employees')
        .query({ departmentId })
        .set('Authorization', `Bearer ${hrAdminToken}`)
        .expect(200);

      expect(
        res.body.items.every(
          (e: { departmentId: string }) => e.departmentId === departmentId,
        ),
      ).toBe(true);
    });
  });

  describe('GET /api/v1/employees/:id', () => {
    it('shows full sensitive fields to HR Admin', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/employees/${employeeId}`)
        .set('Authorization', `Bearer ${hrAdminToken}`)
        .expect(200);
      expect(res.body.pan).toBe(baseFields.pan);
    });

    it('shows full sensitive fields to the employee viewing themselves', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/employees/${employeeId}`)
        .set('Authorization', `Bearer ${employeeToken}`)
        .expect(200);
      expect(res.body.pan).toBe(baseFields.pan);
    });

    it("masks sensitive fields for a manager viewing a report's profile", async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/employees/${employeeId}`)
        .set('Authorization', `Bearer ${managerToken}`)
        .expect(200);
      expect(res.body.pan).not.toBe(baseFields.pan);
    });

    it('rejects an employee viewing an unrelated employee', async () => {
      await request(app.getHttpServer())
        .get(`/api/v1/employees/${otherEmployeeId}`)
        .set('Authorization', `Bearer ${employeeToken}`)
        .expect(403);
    });

    it('rejects a manager viewing an employee outside their reporting line', async () => {
      await request(app.getHttpServer())
        .get(`/api/v1/employees/${otherEmployeeId}`)
        .set('Authorization', `Bearer ${managerToken}`)
        .expect(403);
    });
  });

  describe('PATCH /api/v1/employees/:id', () => {
    it('lets HR Admin update a record directly', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/employees/${employeeId}`)
        .set('Authorization', `Bearer ${hrAdminToken}`)
        .send({ phone: '2000000000' })
        .expect(200);
      expect(res.body.phone).toBe('2000000000');
    });

    it('creates a change request instead of writing directly when the employee edits their own profile', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/employees/${employeeId}`)
        .set('Authorization', `Bearer ${employeeToken}`)
        .send({ phone: '3000000000' })
        .expect(200);
      expect(res.body.changeRequestsCreated).toBe(1);

      const current = await prisma.employee.findUnique({
        where: { id: employeeId },
      });
      expect(current?.phone).not.toBe('3000000000');

      const pending = await request(app.getHttpServer())
        .get('/api/v1/employees/change-requests')
        .query({ status: 'PENDING' })
        .set('Authorization', `Bearer ${hrAdminToken}`)
        .expect(200);
      const created = pending.body.find(
        (r: { employeeId: string; newValue: string }) =>
          r.employeeId === employeeId && r.newValue === '3000000000',
      );
      expect(created).toBeDefined();

      await request(app.getHttpServer())
        .post(`/api/v1/employees/change-requests/${created.id}/approve`)
        .set('Authorization', `Bearer ${hrAdminToken}`)
        .expect(201);

      const updated = await prisma.employee.findUnique({
        where: { id: employeeId },
      });
      expect(updated?.phone).toBe('3000000000');
    });

    it("rejects an employee updating someone else's profile", async () => {
      await request(app.getHttpServer())
        .patch(`/api/v1/employees/${otherEmployeeId}`)
        .set('Authorization', `Bearer ${employeeToken}`)
        .send({ phone: '4000000000' })
        .expect(403);
    });
  });

  describe('GET /api/v1/employees/:id/org-chart', () => {
    it('returns the reporting chain up and down', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/employees/${managerId}/org-chart`)
        .set('Authorization', `Bearer ${hrAdminToken}`)
        .expect(200);

      expect(
        res.body.managers.some((m: { id: string }) => m.id === superAdminId),
      ).toBe(true);
      expect(
        res.body.directReports.some((r: { id: string }) => r.id === employeeId),
      ).toBe(true);
    });
  });

  describe('POST /api/v1/employees/bulk-import', () => {
    it('dry-run rejects rows missing mandatory fields and accepts valid ones', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/employees/bulk-import')
        .set('Authorization', `Bearer ${hrAdminToken}`)
        .send({
          dryRun: true,
          rows: [
            {
              companyId,
              departmentId,
              designationId,
              reportingManagerId: managerId,
              firstName: 'Valid',
              lastName: 'Row',
              status: EmployeeStatus.ACTIVE_PROBATION,
              dob: '1990-01-01',
              gender: Gender.PREFER_NOT_TO_SAY,
              dateOfJoining: '2024-01-01',
              pan: 'ABCDE1234F',
              bankAccountNumber: '000123456789',
              emergencyContactName: 'Emergency Contact',
              emergencyContactPhone: '9999999999',
            },
            { firstName: 'Missing', lastName: 'Fields' },
          ],
        })
        .expect(201);

      expect(res.body.totalRows).toBe(2);
      expect(res.body.successCount).toBe(1);
      expect(res.body.failureCount).toBe(1);
      expect(res.body.results[1].errors.length).toBeGreaterThan(0);
    });
  });
});
