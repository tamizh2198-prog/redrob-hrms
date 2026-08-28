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

describe('Shift + Holiday (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaClient;

  let companyId: string;
  let departmentId: string;
  let designationId: string;
  let locationId: string;
  let shiftId: string;

  let hrAdminId: string;
  let managerId: string;
  let employeeId: string;

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
      data: { name: 'ALSH E2E Co' },
    });
    companyId = company.id;

    const department = await prisma.department.create({
      data: { companyId, name: 'ALSH Dept', code: `ALSH-DEPT-${Date.now()}` },
    });
    departmentId = department.id;

    const designation = await prisma.designation.create({
      data: { companyId, name: 'ALSH Role', code: `ALSH-DESIG-${Date.now()}` },
    });
    designationId = designation.id;

    const location = await prisma.location.create({
      data: { companyId, name: 'ALSH City', code: `ALSH-LOC-${Date.now()}` },
    });
    locationId = location.id;

    const shift = await prisma.shift.create({
      data: {
        companyId,
        name: `ALSH Shift ${Date.now()}`,
        startTime: '09:00',
        endTime: '18:00',
        graceMinutes: 10,
        halfDayHours: 4.5,
      },
    });
    shiftId = shift.id;

    const hrAdmin = await prisma.employee.create({
      data: {
        ...baseFields,
        companyId,
        departmentId,
        designationId,
        locationId,
        employeeCode: `ALSH-HR-${Date.now()}`,
        firstName: 'ALSH',
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
        locationId,
        employeeCode: `ALSH-MGR-${Date.now()}`,
        firstName: 'ALSH',
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
        locationId,
        employeeCode: `ALSH-EMP-${Date.now()}`,
        firstName: 'ALSH',
        lastName: 'Employee',
        role: Role.EMPLOYEE,
        reportingManagerId: managerId,
      },
    });
    employeeId = employee.id;

    hrAdminToken = await login(hrAdmin.employeeCode);
    managerToken = await login(manager.employeeCode);
    employeeToken = await login(employee.employeeCode);
  });

  afterAll(async () => {
    await prisma.optionalHolidaySelection.deleteMany({ where: { employeeId } });
    await prisma.holiday.deleteMany({ where: { locationId } });
    await prisma.rosterEntry.deleteMany({
      where: { employeeId: { in: [employeeId, managerId, hrAdminId] } },
    });
    await prisma.notification.deleteMany({
      where: { employeeId: { in: [employeeId, managerId, hrAdminId] } },
    });
    await prisma.notificationLog.deleteMany({
      where: { employeeId: { in: [employeeId, managerId, hrAdminId] } },
    });
    await prisma.refreshToken.deleteMany({
      where: { employeeId: { in: [employeeId, managerId, hrAdminId] } },
    });
    await prisma.employee.deleteMany({
      where: { id: { in: [employeeId, managerId, hrAdminId] } },
    });
    await prisma.shift.delete({ where: { id: shiftId } });
    await prisma.location.delete({ where: { id: locationId } });
    await prisma.designation.delete({ where: { id: designationId } });
    await prisma.department.delete({ where: { id: departmentId } });
    await prisma.company.delete({ where: { id: companyId } });
    await prisma.$disconnect();
    await app.close();
  });

  describe('POST /api/v1/shifts + /api/v1/roster/assign', () => {
    it('rejects shift creation by a non-HR-Admin', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/shifts')
        .set('Authorization', `Bearer ${employeeToken}`)
        .send({ name: 'X', startTime: '09:00', endTime: '18:00' })
        .expect(403);
    });

    it('assigns the roster for the employee (bulk assignment)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/roster/assign')
        .set('Authorization', `Bearer ${hrAdminToken}`)
        .send({
          employeeIds: [employeeId],
          dates: [
            '2027-03-02',
            '2027-03-03',
            '2027-03-04',
            '2027-03-05',
            '2027-03-06',
          ],
          shiftId,
        })
        .expect(201);

      expect(res.body.successCount).toBe(5);
    });

    it('marks Saturday/Sunday as week-off for the employee', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/roster/assign')
        .set('Authorization', `Bearer ${hrAdminToken}`)
        .send({
          employeeIds: [employeeId],
          dates: ['2027-03-07', '2027-03-08'],
          isWeekOff: true,
        })
        .expect(201);

      const roster = await prisma.rosterEntry.findMany({
        where: { employeeId },
      });
      expect(roster.some((r) => r.isWeekOff)).toBe(true);
    });
  });

  describe('POST /api/v1/holidays/calendar', () => {
    it('publishes a holiday calendar for the location', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/holidays/calendar')
        .set('Authorization', `Bearer ${hrAdminToken}`)
        .send({
          locationId,
          year: 2027,
          holidays: [{ date: '2027-03-04', name: 'ALSH Test Holiday' }],
        })
        .expect(201);

      expect(res.body).toHaveLength(1);
    });

    it('rejects publishing a duplicate date on the same calendar', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/holidays/calendar')
        .set('Authorization', `Bearer ${hrAdminToken}`)
        .send({
          locationId,
          year: 2027,
          holidays: [{ date: '2027-03-04', name: 'Dup' }],
        })
        .expect(400);
    });
  });

  describe('POST /api/v1/holidays/optional/select', () => {
    it('lets an employee select a published optional holiday', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/holidays/calendar')
        .set('Authorization', `Bearer ${hrAdminToken}`)
        .send({
          locationId,
          year: 2027,
          holidays: [
            {
              date: '2027-12-25',
              name: 'ALSH Optional Holiday',
              isOptional: true,
            },
          ],
        })
        .expect(201);

      const holidays = await prisma.holiday.findMany({
        where: { locationId, isOptional: true },
      });
      const optionalHoliday = holidays[0];

      await request(app.getHttpServer())
        .post('/api/v1/holidays/optional/select')
        .set('Authorization', `Bearer ${employeeToken}`)
        .send({ holidayId: optionalHoliday.id })
        .expect(201);

      const selections = await prisma.optionalHolidaySelection.findMany({
        where: { employeeId },
      });
      expect(selections).toHaveLength(1);
    });
  });
});
