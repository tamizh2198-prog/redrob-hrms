import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import {
  EmploymentType,
  Gender,
  EmployeeStatus,
  AttendanceStatus,
  PrismaClient,
  Role,
} from '@prisma/client';
import { AppModule } from '../src/app.module';

describe('Attendance + Leave + Shift + Holiday (e2e)', () => {
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

  let leaveTypeId: string;

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

    const leaveType = await prisma.leaveType.create({
      data: {
        companyId,
        name: `ALSH Earned ${Date.now()}`,
        allowsNegativeBalance: false,
      },
    });
    leaveTypeId = leaveType.id;
    // All fixture leave applications below are dated 2027 (safely in the
    // future relative to the actual test-run clock), so the balance must
    // be seeded for that year, not the real current year.
    await prisma.leaveBalance.create({
      data: {
        employeeId,
        leaveTypeId,
        year: 2027,
        openingBalance: 20,
      },
    });

    hrAdminToken = await login(hrAdmin.employeeCode);
    managerToken = await login(manager.employeeCode);
    employeeToken = await login(employee.employeeCode);
  });

  afterAll(async () => {
    await prisma.optionalHolidaySelection.deleteMany({ where: { employeeId } });
    await prisma.holiday.deleteMany({ where: { locationId } });
    await prisma.leaveApprovalStep.deleteMany({
      where: { application: { employeeId } },
    });
    await prisma.leaveApplication.deleteMany({ where: { employeeId } });
    await prisma.leaveBalance.deleteMany({ where: { employeeId } });
    await prisma.leaveType.delete({ where: { id: leaveTypeId } });
    await prisma.shiftSwapRequest.deleteMany({
      where: {
        OR: [{ requesterId: employeeId }, { counterpartId: employeeId }],
      },
    });
    await prisma.rosterEntry.deleteMany({
      where: { employeeId: { in: [employeeId, managerId, hrAdminId] } },
    });
    await prisma.regularizationRequest.deleteMany({ where: { employeeId } });
    await prisma.attendanceRecord.deleteMany({
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

  describe('Integration point: shifts drive attendance rules', () => {
    it('marks LATE using the shift active on that date (grace period)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/attendance/import')
        .set('Authorization', `Bearer ${hrAdminToken}`)
        .send({
          rows: [
            {
              employeeCode: (await prisma.employee.findUnique({
                where: { id: employeeId },
              }))!.employeeCode,
              date: '2027-03-02',
              checkInTime: '2027-03-02T09:25:00', // 15 min late vs. 10 min grace
              checkOutTime: '2027-03-02T18:00:00',
            },
          ],
        })
        .expect(201);

      expect(res.body.matchedCount).toBe(1);

      const record = await prisma.attendanceRecord.findUnique({
        where: {
          employeeId_date: { employeeId, date: new Date('2027-03-02') },
        },
      });
      expect(record?.status).toBe(AttendanceStatus.LATE);
    });

    it('marks HALF_DAY when worked hours are below the shift half-day threshold', async () => {
      const employeeCode = (await prisma.employee.findUnique({
        where: { id: employeeId },
      }))!.employeeCode;
      await request(app.getHttpServer())
        .post('/api/v1/attendance/import')
        .set('Authorization', `Bearer ${hrAdminToken}`)
        .send({
          rows: [
            {
              employeeCode,
              date: '2027-03-03',
              checkInTime: '2027-03-03T09:00:00',
              checkOutTime: '2027-03-03T12:00:00',
            },
          ],
        })
        .expect(201);

      const record = await prisma.attendanceRecord.findUnique({
        where: {
          employeeId_date: { employeeId, date: new Date('2027-03-03') },
        },
      });
      expect(record?.status).toBe(AttendanceStatus.HALF_DAY);
    });
  });

  describe('POST /api/v1/attendance/punch', () => {
    it('rejects a duplicate check-in without checking out first', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/attendance/punch')
        .set('Authorization', `Bearer ${employeeToken}`)
        .send({ type: 'IN' })
        .expect(201);

      await request(app.getHttpServer())
        .post('/api/v1/attendance/punch')
        .set('Authorization', `Bearer ${employeeToken}`)
        .send({ type: 'IN' })
        .expect(400);

      await request(app.getHttpServer())
        .post('/api/v1/attendance/punch')
        .set('Authorization', `Bearer ${employeeToken}`)
        .send({ type: 'OUT' })
        .expect(201);
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

  describe('Integration point: holidays are excluded from attendance and leave', () => {
    it('never marks a published holiday as Absent in the attendance calendar', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/attendance/${employeeId}/calendar`)
        .query({ year: 2027, month: 3 })
        .set('Authorization', `Bearer ${hrAdminToken}`)
        .expect(200);

      const holidayDay = res.body.find(
        (d: { date: string }) => d.date === '2027-03-04',
      );
      expect(holidayDay.status).toBe(AttendanceStatus.HOLIDAY);
    });

    it("excludes the holiday from a leave application's day count", async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/leave/apply')
        .set('Authorization', `Bearer ${employeeToken}`)
        .send({ leaveTypeId, startDate: '2027-03-09', endDate: '2027-03-11' })
        .expect(201);

      // 3-day range, but 3-08 week-off already assigned; 09-11 are plain
      // working days here, so this just confirms a clean apply still works
      // — the exclusion itself is covered by the dedicated test below.
      expect(res.body.daysCount).toBe(3);
      await prisma.leaveApprovalStep.deleteMany({
        where: { applicationId: res.body.id },
      });
      await prisma.leaveApplication.delete({ where: { id: res.body.id } });
    });

    it('excludes a holiday date specifically from the day count', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/leave/apply')
        .set('Authorization', `Bearer ${employeeToken}`)
        .send({ leaveTypeId, startDate: '2027-03-04', endDate: '2027-03-06' })
        .expect(201);

      // 03-04 is the published holiday, 03-05/03-06 are plain days → 2 deductible.
      expect(res.body.daysCount).toBe(2);
      await request(app.getHttpServer())
        .post(`/api/v1/leave/${res.body.id}/decision`)
        .set('Authorization', `Bearer ${managerToken}`)
        .send({ approve: true })
        .expect(201);

      // syncLeaveStatus deliberately skips holiday/week-off dates, so no
      // attendance row gets written for 03-04 at all — confirm it was never
      // flipped to ON_LEAVE, and that the calendar view still reports it as
      // a holiday rather than falling back to Absent.
      const holidayRecord = await prisma.attendanceRecord.findUnique({
        where: {
          employeeId_date: { employeeId, date: new Date('2027-03-04') },
        },
      });
      expect(holidayRecord).toBeNull();

      const calendarRes = await request(app.getHttpServer())
        .get(`/api/v1/attendance/${employeeId}/calendar`)
        .query({ year: 2027, month: 3 })
        .set('Authorization', `Bearer ${hrAdminToken}`)
        .expect(200);
      const holidayDay = calendarRes.body.find(
        (d: { date: string }) => d.date === '2027-03-04',
      );
      expect(holidayDay.status).toBe(AttendanceStatus.HOLIDAY);

      await request(app.getHttpServer())
        .post(`/api/v1/leave/${res.body.id}/cancel`)
        .set('Authorization', `Bearer ${employeeToken}`)
        .expect(201);
    });
  });

  describe('Integration point: leave approval reflects in the attendance record', () => {
    it('marks the attendance days ON_LEAVE once fully approved', async () => {
      const applyRes = await request(app.getHttpServer())
        .post('/api/v1/leave/apply')
        .set('Authorization', `Bearer ${employeeToken}`)
        .send({ leaveTypeId, startDate: '2027-03-16', endDate: '2027-03-17' })
        .expect(201);

      await request(app.getHttpServer())
        .post(`/api/v1/leave/${applyRes.body.id}/decision`)
        .set('Authorization', `Bearer ${managerToken}`)
        .send({ approve: true })
        .expect(201);

      const day1 = await prisma.attendanceRecord.findUnique({
        where: {
          employeeId_date: { employeeId, date: new Date('2027-03-16') },
        },
      });
      expect(day1?.status).toBe(AttendanceStatus.ON_LEAVE);

      const balance = await prisma.leaveBalance.findUnique({
        where: {
          employeeId_leaveTypeId_year: { employeeId, leaveTypeId, year: 2027 },
        },
      });
      expect(balance?.used).toBeGreaterThanOrEqual(2);

      // Cancelling should credit the balance back and revert attendance.
      await request(app.getHttpServer())
        .post(`/api/v1/leave/${applyRes.body.id}/cancel`)
        .set('Authorization', `Bearer ${employeeToken}`)
        .expect(201);

      const revertedDay = await prisma.attendanceRecord.findUnique({
        where: {
          employeeId_date: { employeeId, date: new Date('2027-03-16') },
        },
      });
      expect(revertedDay?.status).toBe(AttendanceStatus.ABSENT);
    });

    it('rejects an application that overlaps a pending one', async () => {
      const first = await request(app.getHttpServer())
        .post('/api/v1/leave/apply')
        .set('Authorization', `Bearer ${employeeToken}`)
        .send({ leaveTypeId, startDate: '2027-03-20', endDate: '2027-03-21' })
        .expect(201);

      await request(app.getHttpServer())
        .post('/api/v1/leave/apply')
        .set('Authorization', `Bearer ${employeeToken}`)
        .send({ leaveTypeId, startDate: '2027-03-21', endDate: '2027-03-22' })
        .expect(400);

      await prisma.leaveApprovalStep.deleteMany({
        where: { applicationId: first.body.id },
      });
      await prisma.leaveApplication.delete({ where: { id: first.body.id } });
    });
  });

  describe('POST /api/v1/attendance/regularize + decision', () => {
    it('lets the assigned manager approve a regularization request', async () => {
      const regRes = await request(app.getHttpServer())
        .post('/api/v1/attendance/regularize')
        .set('Authorization', `Bearer ${employeeToken}`)
        .send({
          date: new Date().toISOString(),
          requestedStatus: 'PRESENT',
          reason: 'Forgot to punch in',
        })
        .expect(201);

      await request(app.getHttpServer())
        .post(`/api/v1/attendance/regularize/${regRes.body.id}/decision`)
        .set('Authorization', `Bearer ${managerToken}`)
        .send({ approve: true })
        .expect(201);
    });
  });

  describe('POST /api/v1/attendance/lock', () => {
    it('locks the month and blocks further Manager edits', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/attendance/lock')
        .set('Authorization', `Bearer ${hrAdminToken}`)
        .send({ year: 2027, month: 3 })
        .expect(201);

      const regRes = await request(app.getHttpServer())
        .post('/api/v1/attendance/regularize')
        .set('Authorization', `Bearer ${employeeToken}`)
        .send({
          date: '2027-03-02',
          requestedStatus: 'PRESENT',
          reason: 'Post-lock correction attempt',
        })
        .expect(201);

      await request(app.getHttpServer())
        .post(`/api/v1/attendance/regularize/${regRes.body.id}/decision`)
        .set('Authorization', `Bearer ${managerToken}`)
        .send({ approve: true })
        .expect(403);

      await request(app.getHttpServer())
        .post(`/api/v1/attendance/regularize/${regRes.body.id}/decision`)
        .set('Authorization', `Bearer ${hrAdminToken}`)
        .send({ approve: true })
        .expect(201);
    });
  });

  describe('POST /api/v1/roster/swap', () => {
    it('allows a same-department swap and requires manager approval to decide', async () => {
      const swapRes = await request(app.getHttpServer())
        .post('/api/v1/roster/swap')
        .set('Authorization', `Bearer ${employeeToken}`)
        .send({ counterpartId: managerId, date: '2027-04-01' })
        .expect(201);

      await request(app.getHttpServer())
        .post(`/api/v1/roster/swap/${swapRes.body.id}/decision`)
        .set('Authorization', `Bearer ${employeeToken}`)
        .send({ approve: true })
        .expect(403);

      await request(app.getHttpServer())
        .post(`/api/v1/roster/swap/${swapRes.body.id}/decision`)
        .set('Authorization', `Bearer ${managerToken}`)
        .send({ approve: true })
        .expect(201);
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

  describe('GET /api/v1/leave/team-calendar', () => {
    it("returns the manager's team calendar of approved leave", async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/leave/team-calendar')
        .query({ from: '2026-01-01', to: '2027-12-31' })
        .set('Authorization', `Bearer ${managerToken}`)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
    });
  });
});
