import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { EmployeeStatus, Gender, Prisma, Role } from '@prisma/client';
import { EmployeeService } from './employee.service';
import { PrismaService } from '../../shared/database/prisma.service';
import { NotificationService } from '../../shared/notifications/notification.service';
import { EmailService } from '../../shared/email/email.service';
import { hashInvitationToken } from './invitation-token.util';

// Every model deleteEmployee() touches, across all three handling
// strategies (owned/nullable/blocking — see employee.service.ts). Some
// models appear in more than one strategy (e.g. `ticket` is both nulled on
// assignedAgentId and a blocking check on employeeId), so every model here
// gets all three methods stubbed regardless of which it actually needs —
// simpler than tracking the exact subset per model.
const EMPLOYEE_OWNED_MODEL_NAMES = [
  'refreshToken',
  'employeeDocument',
  'rosterEntry',
  'employeeHybridSchedule',
  'optionalHolidaySelection',
  'attendanceRecord',
  'regularizationRequest',
  'leaveBalance',
  'leaveApplication',
  'onboardingChecklist',
  'preboardingSubmission',
  'assetAssignment',
  'assetRequest',
  'resignation',
  'exitInterview',
  'finalSettlement',
  'announcementAck',
  'assistantConversation',
  'notification',
  'notificationPreference',
  'notificationLog',
  // Nullable secondary-role references (updateMany)
  'ticketSlaPolicy',
  'ticket',
  'shiftSwapRequest',
  // Blocking required references (count)
  'goal',
  'review',
  'monthlyEvaluation',
  'jobRequisition',
  'interviewRound',
  'ticketMessage',
  'announcement',
  'recognition',
  'policyDocument',
  'savedReport',
  'workflowDefinition',
  'approvalRequest',
  'workflowApprovalDecision',
] as const;

function createMockPrisma() {
  const dynamicModels: Record<
    string,
    {
      deleteMany: jest.Mock;
      updateMany: jest.Mock;
      count: jest.Mock;
      findUnique: jest.Mock;
      findMany: jest.Mock;
    }
  > = Object.fromEntries(
    EMPLOYEE_OWNED_MODEL_NAMES.map((name) => [
      name,
      {
        deleteMany: jest.fn(),
        updateMany: jest.fn(),
        count: jest.fn(),
        findUnique: jest.fn(),
        // Defaults to [] (not undefined) since deleteEmployee()'s grandchild
        // cleanup for LeaveApplication/AssistantConversation immediately
        // calls .length on the result — an unconfigured test shouldn't crash.
        findMany: jest.fn().mockResolvedValue([]),
      },
    ]),
  );

  const prisma = {
    employee: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      delete: jest.fn(),
      findUniqueOrThrow: jest.fn(),
    },
    employeeHistory: {
      createMany: jest.fn(),
      create: jest.fn(),
      deleteMany: jest.fn(),
    },
    profileChangeRequest: {
      create: jest.fn(),
      createMany: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      deleteMany: jest.fn(),
    },
    company: {
      findFirst: jest.fn(),
      create: jest.fn(),
    },
    employeeInvitation: {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
      deleteMany: jest.fn(),
    },
    ...dynamicModels,
    // deleteEmployee()'s grandchild cleanup — these four models only ever
    // need deleteMany (they're always the leaf being cleared, never
    // queried first) — the parent-side findUnique/findMany already come
    // from dynamicModels above (onboardingChecklist, resignation,
    // leaveApplication, assistantConversation).
    checklistTask: { deleteMany: jest.fn() },
    clearanceItem: { deleteMany: jest.fn() },
    lwdAdjustment: { deleteMany: jest.fn() },
    leaveApprovalStep: { deleteMany: jest.fn() },
    assistantMessage: { deleteMany: jest.fn() },
    $transaction: jest.fn(),
  };

  // Supports both call styles the service uses: an array of promises
  // (dismissEmployee) and a callback receiving the transaction client
  // (deleteEmployee) — individual tests still override the resolved value
  // via mockResolvedValue when they need to assert on a specific outcome.
  prisma.$transaction.mockImplementation((arg: unknown) =>
    Array.isArray(arg) ? Promise.all(arg) : (arg as (tx: unknown) => unknown)(prisma),
  );

  // Named properties stay dot-accessible as inferred; the intersection adds
  // index access for the dynamically-named EMPLOYEE_OWNED_MODEL_NAMES
  // entries spread in above (e.g. prisma.attendanceRecord.deleteMany).
  return prisma as typeof prisma &
    Record<
      string,
      {
        deleteMany: jest.Mock;
        updateMany: jest.Mock;
        count: jest.Mock;
        findUnique: jest.Mock;
        findMany: jest.Mock;
      }
    >;
}

function createMockNotifications() {
  return { send: jest.fn().mockResolvedValue(undefined) };
}

function createMockEmail() {
  return { send: jest.fn().mockResolvedValue({ sent: true }) };
}

const VALID_ACTIVE_FIELDS = {
  firstName: 'Jane',
  lastName: 'Doe',
  dob: '1990-01-01',
  gender: Gender.FEMALE,
  departmentId: 'dept-1',
  designationId: 'desig-1',
  reportingManagerId: 'mgr-1',
  dateOfJoining: '2024-01-01',
  pan: 'ABCDE1234F',
  bankAccountNumber: '123456789',
  emergencyContactName: 'John Doe',
  emergencyContactPhone: '9999999999',
};

describe('EmployeeService', () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let notifications: ReturnType<typeof createMockNotifications>;
  let email: ReturnType<typeof createMockEmail>;
  let service: EmployeeService;

  beforeEach(() => {
    prisma = createMockPrisma();
    notifications = createMockNotifications();
    email = createMockEmail();
    service = new EmployeeService(
      prisma as unknown as PrismaService,
      notifications as unknown as NotificationService,
      email as unknown as EmailService,
    );
    prisma.company.findFirst.mockResolvedValue({ id: 'company-1' });
    prisma.employee.count.mockResolvedValue(0);
    prisma.employee.findFirst.mockResolvedValue(null);
  });

  describe('employee code generation (Business Rule: system-generated, unique, immutable)', () => {
    it('generates a code in the MNR-<year>-<seq> format', async () => {
      prisma.employee.create.mockResolvedValue({
        id: 'emp-1',
        employeeCode: 'MNR-2026-0001',
      });

      await service.create(VALID_ACTIVE_FIELDS, 'actor-1');

      const createArgs = prisma.employee.create.mock.calls[0][0];
      expect(createArgs.data.employeeCode).toMatch(/^MNR-\d{4}-0001$/);
    });

    it('continues from the highest existing code rather than a row count, so a gap from a deleted employee is never reused', async () => {
      // Row count is only 1 (one of two MNR-2026-* rows was deleted), but the
      // surviving row is 0003 — a count-based sequence would regenerate 0002
      // and collide; max-based generation must produce 0004.
      prisma.employee.findFirst.mockResolvedValueOnce({
        employeeCode: 'MNR-2026-0003',
      });
      prisma.employee.create.mockResolvedValue({
        id: 'emp-1',
        employeeCode: 'MNR-2026-0004',
      });

      await service.create(VALID_ACTIVE_FIELDS, 'actor-1');

      const createArgs = prisma.employee.create.mock.calls[0][0];
      expect(createArgs.data.employeeCode).toBe('MNR-2026-0004');
    });

    it('retries with a new code on a unique-constraint collision', async () => {
      const conflictError = new Prisma.PrismaClientKnownRequestError(
        'Unique constraint failed',
        { code: 'P2002', clientVersion: '6.0.0' },
      );
      prisma.employee.create
        .mockRejectedValueOnce(conflictError)
        .mockResolvedValueOnce({ id: 'emp-1', employeeCode: 'MNR-2026-0002' });
      prisma.employee.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ employeeCode: 'MNR-2026-0001' });

      const result = await service.create(VALID_ACTIVE_FIELDS, 'actor-1');

      expect(prisma.employee.create).toHaveBeenCalledTimes(2);
      expect(result.employeeCode).toBe('MNR-2026-0002');
    });
  });

  describe('mandatory fields for Active status', () => {
    it('rejects a new hire (default ACTIVE_PROBATION) missing mandatory fields', async () => {
      await expect(
        service.create({ firstName: 'Jane', lastName: 'Doe' }, 'actor-1'),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.employee.create).not.toHaveBeenCalled();
    });

    it('accepts a new hire when all mandatory fields are present', async () => {
      prisma.employee.create.mockResolvedValue({
        id: 'emp-1',
        employeeCode: 'EMP-2026-0001',
      });

      await expect(
        service.create(VALID_ACTIVE_FIELDS as never, 'actor-1'),
      ).resolves.toBeDefined();
    });

    it('does not require mandatory fields for a non-active status', async () => {
      prisma.employee.create.mockResolvedValue({ id: 'emp-1' });

      await expect(
        service.create(
          {
            firstName: 'Jane',
            lastName: 'Doe',
            status: EmployeeStatus.INACTIVE,
          },
          'actor-1',
        ),
      ).resolves.toBeDefined();
    });
  });

  describe('circular reporting-manager validation', () => {
    it('rejects an employee being set as their own manager', async () => {
      prisma.employee.findUnique.mockResolvedValueOnce({
        id: 'emp-1',
        status: EmployeeStatus.ACTIVE,
      });

      await expect(
        service.update(
          'emp-1',
          { reportingManagerId: 'emp-1' },
          {
            userId: 'hr-1',
            role: Role.HR_ADMIN,
          },
        ),
      ).rejects.toThrow('An employee cannot be their own reporting manager');
    });

    it('rejects assigning a manager who is transitively a report of the employee', async () => {
      // emp-1 currently manages emp-2, which manages emp-3.
      // Assigning emp-3 as emp-1's manager would create a cycle.
      prisma.employee.findUnique
        .mockResolvedValueOnce({ id: 'emp-1', status: EmployeeStatus.ACTIVE })
        .mockResolvedValueOnce({ reportingManagerId: 'emp-2' }) // walk from emp-3
        .mockResolvedValueOnce({ reportingManagerId: 'emp-1' }); // walk from emp-2

      await expect(
        service.update(
          'emp-1',
          { reportingManagerId: 'emp-3' },
          {
            userId: 'hr-1',
            role: Role.HR_ADMIN,
          },
        ),
      ).rejects.toThrow('Circular reporting-manager assignment is not allowed');
    });
  });

  describe('sensitive-field masking', () => {
    const employee = {
      id: 'emp-1',
      pan: 'ABCDE1234F',
      aadhaar: '123456789012',
      bankAccountNumber: '000111222333',
    };

    it('shows full values to HR Admin', () => {
      const result = service.maskSensitiveFields(employee as never, {
        userId: 'hr-1',
        role: Role.HR_ADMIN,
      });
      expect(result.pan).toBe('ABCDE1234F');
    });

    it('shows full values to the employee viewing themselves', () => {
      const result = service.maskSensitiveFields(employee as never, {
        userId: 'emp-1',
        role: Role.EMPLOYEE,
      });
      expect(result.pan).toBe('ABCDE1234F');
    });

    it('masks values for a manager viewing someone else', () => {
      const result = service.maskSensitiveFields(employee as never, {
        userId: 'mgr-1',
        role: Role.MANAGER,
      });
      expect(result.pan).toBe('****234F');
      expect(result.aadhaar).toBe('****9012');
    });

    it('reveal endpoint rejects a manager viewing someone else', async () => {
      await expect(
        service.revealSensitiveFields('emp-1', {
          userId: 'mgr-1',
          role: Role.MANAGER,
        }),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('employee-submitted profile changes never bypass approval', () => {
    it('creates a change request instead of writing directly when the employee edits their own profile', async () => {
      prisma.employee.findUnique.mockResolvedValueOnce({
        id: 'emp-1',
        status: EmployeeStatus.ACTIVE,
      });
      prisma.employee.findUniqueOrThrow.mockResolvedValueOnce({
        id: 'emp-1',
        phone: '111',
      });

      await service.update(
        'emp-1',
        { phone: '9998887777' },
        {
          userId: 'emp-1',
          role: Role.EMPLOYEE,
        },
      );

      expect(prisma.employee.update).not.toHaveBeenCalled();
      expect(prisma.profileChangeRequest.createMany).toHaveBeenCalledWith({
        data: [
          expect.objectContaining({
            employeeId: 'emp-1',
            fieldName: 'phone',
            newValue: '9998887777',
          }),
        ],
      });
      expect(notifications.send).toHaveBeenCalledWith(
        expect.objectContaining({ template: 'profile-change.submitted' }),
      );
    });

    it("treats a new hire's own PAN/bank/IFSC/blood-group entry as a self-service change request too", async () => {
      prisma.employee.findUnique.mockResolvedValueOnce({
        id: 'emp-1',
        status: EmployeeStatus.PREBOARDING,
      });
      prisma.employee.findUniqueOrThrow.mockResolvedValueOnce({
        id: 'emp-1',
        pan: null,
        bankAccountNumber: null,
        ifscCode: null,
        bloodGroup: null,
      });

      await service.update(
        'emp-1',
        {
          pan: 'ABCDE1234F',
          bankAccountNumber: '1234567890',
          ifscCode: 'HDFC0001234',
          bloodGroup: 'O_POSITIVE',
        },
        { userId: 'emp-1', role: Role.EMPLOYEE },
      );

      expect(prisma.employee.update).not.toHaveBeenCalled();
      expect(prisma.profileChangeRequest.createMany).toHaveBeenCalledWith({
        data: expect.arrayContaining([
          expect.objectContaining({ fieldName: 'pan', newValue: 'ABCDE1234F' }),
          expect.objectContaining({
            fieldName: 'bloodGroup',
            newValue: 'O_POSITIVE',
          }),
        ]),
      });
    });

    it('lets a new hire submit their own date of birth as a self-service change request', async () => {
      prisma.employee.findUnique.mockResolvedValueOnce({
        id: 'emp-1',
        status: EmployeeStatus.PREBOARDING,
      });
      prisma.employee.findUniqueOrThrow.mockResolvedValueOnce({
        id: 'emp-1',
        dob: null,
      });

      await service.update(
        'emp-1',
        { dob: '1995-05-15' },
        { userId: 'emp-1', role: Role.EMPLOYEE },
      );

      expect(prisma.employee.update).not.toHaveBeenCalled();
      expect(prisma.profileChangeRequest.createMany).toHaveBeenCalledWith({
        data: [
          expect.objectContaining({
            employeeId: 'emp-1',
            fieldName: 'dob',
            oldValue: null,
            newValue: '1995-05-15',
          }),
        ],
      });
    });

    it('does not re-flag dob as changed when resubmitting the same date already on the Date-typed record', async () => {
      prisma.employee.findUnique.mockResolvedValueOnce({
        id: 'emp-1',
        status: EmployeeStatus.ACTIVE,
      });
      prisma.employee.findUniqueOrThrow.mockResolvedValueOnce({
        id: 'emp-1',
        dob: new Date('1995-05-15'),
      });

      await service.update(
        'emp-1',
        { dob: '1995-05-15' },
        { userId: 'emp-1', role: Role.EMPLOYEE },
      );

      expect(prisma.profileChangeRequest.createMany).not.toHaveBeenCalled();
    });
  });

  describe('approving a change request', () => {
    it('converts a dob change request newValue to a real Date before writing (Prisma rejects a bare date string)', async () => {
      prisma.profileChangeRequest.findUnique.mockResolvedValueOnce({
        id: 'req-1',
        employeeId: 'emp-1',
        fieldName: 'dob',
        oldValue: null,
        newValue: '1996-03-20',
        status: 'PENDING',
      });

      await service.approveChangeRequest('req-1', 'hr-1');

      expect(prisma.employee.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'emp-1' },
          data: { dob: new Date('1996-03-20') },
        }),
      );
    });

    it('writes a non-dob field as the plain string, unchanged', async () => {
      prisma.profileChangeRequest.findUnique.mockResolvedValueOnce({
        id: 'req-2',
        employeeId: 'emp-1',
        fieldName: 'phone',
        oldValue: null,
        newValue: '9998887777',
        status: 'PENDING',
      });

      await service.approveChangeRequest('req-2', 'hr-1');

      expect(prisma.employee.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'emp-1' },
          data: { phone: '9998887777' },
        }),
      );
    });
  });

  describe('employee-submitted profile changes never bypass approval, continued', () => {
    it("rejects an employee editing someone else's profile", async () => {
      prisma.employee.findUnique.mockResolvedValueOnce({
        id: 'emp-2',
        status: EmployeeStatus.ACTIVE,
      });

      await expect(
        service.update(
          'emp-2',
          { phone: '123' },
          {
            userId: 'emp-1',
            role: Role.EMPLOYEE,
          },
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('allows HR Admin to update the record directly', async () => {
      prisma.employee.findUnique.mockResolvedValueOnce({
        id: 'emp-1',
        status: EmployeeStatus.ACTIVE,
        firstName: 'Old',
        lastName: 'Doe',
        dob: new Date('1990-01-01'),
        gender: Gender.FEMALE,
        departmentId: 'dept-1',
        designationId: 'desig-1',
        reportingManagerId: 'mgr-1',
        dateOfJoining: new Date('2024-01-01'),
        pan: 'ABCDE1234F',
        bankAccountNumber: '123456789',
        emergencyContactName: 'John Doe',
        emergencyContactPhone: '9999999999',
      });
      prisma.employee.update.mockResolvedValueOnce({
        id: 'emp-1',
        firstName: 'New',
      });

      await service.update(
        'emp-1',
        { firstName: 'New' },
        {
          userId: 'hr-1',
          role: Role.HR_ADMIN,
        },
      );

      expect(prisma.employee.update).toHaveBeenCalled();
      expect(prisma.profileChangeRequest.createMany).not.toHaveBeenCalled();
    });
  });

  describe('This task: Super Admin Excel export of the active roster', () => {
    it('queries only ACTIVE/ACTIVE_PROBATION employees and returns a non-empty xlsx buffer', async () => {
      prisma.employee.findMany.mockResolvedValueOnce([
        {
          employeeCode: 'MNR-2026-0001',
          firstName: 'Zara',
          lastName: 'Pandey',
          workEmail: 'zara@co.com',
          phone: '9999999999',
          employmentType: 'FULL_TIME',
          dateOfJoining: new Date('2024-04-14'),
          status: 'ACTIVE',
          department: { name: 'Engineering' },
          designation: { name: 'Software Engineer' },
          location: { name: 'Bengaluru' },
        },
      ]);

      const buffer = await service.exportActiveEmployees();

      expect(prisma.employee.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { status: { in: [EmployeeStatus.ACTIVE, EmployeeStatus.ACTIVE_PROBATION] } },
        }),
      );
      expect(Buffer.isBuffer(buffer)).toBe(true);
      expect(buffer.length).toBeGreaterThan(0);
    });
  });

  describe('Section 6 data-scope: an Employee only sees their own record in the directory list', () => {
    it("returns just the requester's own record for an EMPLOYEE, ignoring list filters", async () => {
      prisma.employee.findUnique.mockResolvedValueOnce({
        id: 'emp-1',
        pan: 'ABCDE1234F',
        aadhaar: null,
        bankAccountNumber: null,
      });

      const result = await service.findAll(
        { departmentId: 'dept-1' },
        { userId: 'emp-1', role: Role.EMPLOYEE },
      );

      expect(prisma.employee.findMany).not.toHaveBeenCalled();
      expect(result.items).toHaveLength(1);
      expect(result.items[0].id).toBe('emp-1');
      expect(result.total).toBe(1);
    });

    it('returns an empty list rather than throwing if the employee record is somehow missing', async () => {
      prisma.employee.findUnique.mockResolvedValueOnce(null);

      const result = await service.findAll(
        {},
        { userId: 'emp-1', role: Role.EMPLOYEE },
      );

      expect(result.items).toEqual([]);
      expect(result.total).toBe(0);
    });

    it('still returns the full directory for HR Admin', async () => {
      prisma.employee.findMany.mockResolvedValue([
        { id: 'emp-1' },
        { id: 'emp-2' },
      ]);
      prisma.employee.count.mockResolvedValueOnce(2);

      const result = await service.findAll(
        {},
        { userId: 'hr-1', role: Role.HR_ADMIN },
      );

      expect(prisma.employee.findUnique).not.toHaveBeenCalled();
      expect(result.items).toHaveLength(2);
    });

    it('scopes the directory to a Manager\'s own reporting tree, not the whole company', async () => {
      // getReportingHierarchyIds BFS: mgr-1 -> [emp-1, emp-2] -> [emp-3] -> []
      prisma.employee.findMany
        .mockResolvedValueOnce([{ id: 'emp-1' }, { id: 'emp-2' }])
        .mockResolvedValueOnce([{ id: 'emp-3' }])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
          { id: 'mgr-1' },
          { id: 'emp-1' },
          { id: 'emp-2' },
          { id: 'emp-3' },
        ]);
      prisma.employee.count.mockResolvedValueOnce(4);

      const result = await service.findAll(
        {},
        { userId: 'mgr-1', role: Role.MANAGER },
      );

      expect(prisma.employee.findUnique).not.toHaveBeenCalled();
      expect(result.items).toHaveLength(4);
      const listCall =
        prisma.employee.findMany.mock.calls[
          prisma.employee.findMany.mock.calls.length - 1
        ][0];
      expect(listCall.where.id.in).toEqual(
        expect.arrayContaining(['mgr-1', 'emp-1', 'emp-2', 'emp-3']),
      );
    });
  });

  describe('Section 6 data-scope: Manager can only read their own reports', () => {
    it('allows a manager to read a direct report', async () => {
      prisma.employee.findUnique
        .mockResolvedValueOnce({
          id: 'emp-1',
          pan: null,
          aadhaar: null,
          bankAccountNumber: null,
        })
        .mockResolvedValueOnce({ reportingManagerId: 'mgr-1' });

      await expect(
        service.findOne('emp-1', { userId: 'mgr-1', role: Role.MANAGER }),
      ).resolves.toBeDefined();
    });

    it('rejects a manager reading an unrelated employee', async () => {
      prisma.employee.findUnique
        .mockResolvedValueOnce({
          id: 'emp-9',
          pan: null,
          aadhaar: null,
          bankAccountNumber: null,
        })
        .mockResolvedValueOnce({ reportingManagerId: null });

      await expect(
        service.findOne('emp-9', { userId: 'mgr-1', role: Role.MANAGER }),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('Auth Phase 2: employee invitation', () => {
    it('creates an INVITED employee with a system-generated MNR-<year>-<seq> code, an invitation record, and sends the email', async () => {
      prisma.employee.findUnique.mockResolvedValue(null); // no email conflict
      prisma.employee.create.mockResolvedValue({
        id: 'emp-1',
        firstName: 'Jane',
        lastName: 'Doe',
        workEmail: 'jane@co.com',
        employeeCode: 'MNR-2026-0001',
        status: EmployeeStatus.INVITED,
      });

      const result = await service.inviteEmployee(
        {
          email: 'jane@co.com',
          firstName: 'Jane',
          lastName: 'Doe',
        },
        'actor-1',
      );

      const createArg = prisma.employee.create.mock.calls[0][0];
      expect(createArg.data.employeeCode).toMatch(/^MNR-\d{4}-0001$/);
      expect(prisma.employee.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: EmployeeStatus.INVITED }),
        }),
      );
      expect(prisma.employeeInvitation.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ employeeId: 'emp-1' }),
        }),
      );
      expect(email.send).toHaveBeenCalledWith(
        expect.objectContaining({ to: 'jane@co.com' }),
      );
      expect(result.emailSent).toBe(true);
      expect(
        (result.employee as { passwordHash?: string }).passwordHash,
      ).toBeUndefined();
    });

    it('accepts ctcLpa at invite time so a quarterly KPI reward can be computed before the employee ever logs in', async () => {
      prisma.employee.findUnique.mockResolvedValue(null);
      prisma.employee.create.mockResolvedValue({
        id: 'emp-1',
        employeeCode: 'MNR-2026-0001',
      });

      await service.inviteEmployee(
        { email: 'jane@co.com', firstName: 'Jane', lastName: 'Doe', ctcLpa: 12 },
        'actor-1',
      );

      const createArg = prisma.employee.create.mock.calls[0][0];
      expect(createArg.data.ctcLpa).toBe(12);
    });

    it('never accepts a role field from the caller (server-controlled, defaults to EMPLOYEE)', async () => {
      prisma.employee.findUnique.mockResolvedValue(null);
      prisma.employee.create.mockResolvedValue({ id: 'emp-1' });

      await service.inviteEmployee(
        {
          email: 'x@co.com',
          firstName: 'X',
          lastName: 'Y',
        },
        'actor-1',
      );

      const createArg = prisma.employee.create.mock.calls[0][0];
      expect(createArg.data.role).toBeUndefined();
    });

    it('rejects inviting a duplicate email', async () => {
      prisma.employee.findUnique.mockResolvedValueOnce({ id: 'existing-1' });
      await expect(
        service.inviteEmployee(
          {
            email: 'dup@co.com',
            firstName: 'A',
            lastName: 'B',
          },
          'actor-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('retries with a new code on a unique-constraint collision', async () => {
      prisma.employee.findUnique.mockResolvedValue(null);
      const conflictError = new Prisma.PrismaClientKnownRequestError(
        'Unique constraint failed',
        { code: 'P2002', clientVersion: '6.0.0' },
      );
      prisma.employee.create
        .mockRejectedValueOnce(conflictError)
        .mockResolvedValueOnce({ id: 'emp-1', employeeCode: 'MNR-2026-0002' });
      prisma.employee.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ employeeCode: 'MNR-2026-0001' });

      const result = await service.inviteEmployee(
        { email: 'new@co.com', firstName: 'A', lastName: 'B' },
        'actor-1',
      );

      expect(prisma.employee.create).toHaveBeenCalledTimes(2);
      expect((result.employee as { employeeCode?: string }).employeeCode).toBe(
        'MNR-2026-0002',
      );
    });

    it('reports emailSent=false without throwing when email delivery fails', async () => {
      prisma.employee.findUnique.mockResolvedValue(null);
      prisma.employee.create.mockResolvedValue({
        id: 'emp-1',
        firstName: 'Jane',
      });
      email.send.mockResolvedValue({ sent: false });

      const result = await service.inviteEmployee(
        {
          email: 'jane@co.com',
          firstName: 'Jane',
          lastName: 'Doe',
        },
        'actor-1',
      );

      expect(result.emailSent).toBe(false);
    });

    it('this task: connects department/location/reportingManager when provided', async () => {
      prisma.employee.findUnique.mockResolvedValue(null);
      prisma.employee.create.mockResolvedValue({ id: 'emp-1' });

      await service.inviteEmployee(
        {
          email: 'x@co.com',
          firstName: 'X',
          lastName: 'Y',
          departmentId: 'dept-1',
          locationId: 'loc-1',
          reportingManagerId: 'mgr-1',
        },
        'actor-1',
        Role.HR_ADMIN,
      );

      const createArg = prisma.employee.create.mock.calls[0][0];
      expect(createArg.data.department).toEqual({ connect: { id: 'dept-1' } });
      expect(createArg.data.location).toEqual({ connect: { id: 'loc-1' } });
      expect(createArg.data.reportingManager).toEqual({
        connect: { id: 'mgr-1' },
      });
    });

    it('this task: an HR_ADMIN caller may assign the MANAGER role', async () => {
      prisma.employee.findUnique.mockResolvedValue(null);
      prisma.employee.create.mockResolvedValue({ id: 'emp-1' });

      await service.inviteEmployee(
        {
          email: 'x@co.com',
          firstName: 'X',
          lastName: 'Y',
          role: Role.MANAGER,
        },
        'actor-1',
        Role.HR_ADMIN,
      );

      const createArg = prisma.employee.create.mock.calls[0][0];
      expect(createArg.data.role).toBe(Role.MANAGER);
    });

    it('this task: an HR_ADMIN caller CANNOT assign the SUPER_ADMIN role (privilege-escalation guard)', async () => {
      prisma.employee.findUnique.mockResolvedValue(null);
      await expect(
        service.inviteEmployee(
          {
            email: 'x@co.com',
            firstName: 'X',
            lastName: 'Y',
            role: Role.SUPER_ADMIN,
          },
          'actor-1',
          Role.HR_ADMIN,
        ),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.employee.create).not.toHaveBeenCalled();
    });

    it('this task: an HR_ADMIN caller CANNOT assign the HR_ADMIN role either', async () => {
      prisma.employee.findUnique.mockResolvedValue(null);
      await expect(
        service.inviteEmployee(
          {
            email: 'x@co.com',
            firstName: 'X',
            lastName: 'Y',
            role: Role.HR_ADMIN,
          },
          'actor-1',
          Role.HR_ADMIN,
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('this task: a SUPER_ADMIN caller MAY assign the SUPER_ADMIN role', async () => {
      prisma.employee.findUnique.mockResolvedValue(null);
      prisma.employee.create.mockResolvedValue({ id: 'emp-1' });

      await service.inviteEmployee(
        {
          email: 'x@co.com',
          firstName: 'X',
          lastName: 'Y',
          role: Role.SUPER_ADMIN,
        },
        'actor-1',
        Role.SUPER_ADMIN,
      );

      const createArg = prisma.employee.create.mock.calls[0][0];
      expect(createArg.data.role).toBe(Role.SUPER_ADMIN);
    });
  });

  describe('Auth Phase 2: resend invitation', () => {
    it('deletes previous unused invitations and issues a new one', async () => {
      prisma.employee.findUnique.mockResolvedValue({
        id: 'emp-1',
        status: EmployeeStatus.INVITED,
        workEmail: 'jane@co.com',
        firstName: 'Jane',
      });

      await service.resendInvitation('emp-1', 'actor-1');

      expect(prisma.employeeInvitation.deleteMany).toHaveBeenCalledWith({
        where: { employeeId: 'emp-1', usedAt: null },
      });
      expect(prisma.employeeInvitation.create).toHaveBeenCalled();
    });

    it('rejects resending for an already-active employee', async () => {
      prisma.employee.findUnique.mockResolvedValue({
        id: 'emp-1',
        status: EmployeeStatus.ACTIVE,
        workEmail: 'jane@co.com',
      });
      await expect(
        service.resendInvitation('emp-1', 'actor-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException for an unknown employee', async () => {
      prisma.employee.findUnique.mockResolvedValue(null);
      await expect(
        service.resendInvitation('missing', 'actor-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('this task: reports emailSent=true when the reminder email is actually delivered', async () => {
      prisma.employee.findUnique.mockResolvedValue({
        id: 'emp-1',
        status: EmployeeStatus.INVITED,
        workEmail: 'jane@co.com',
        firstName: 'Jane',
      });
      email.send.mockResolvedValue({ sent: true });

      const result = await service.resendInvitation('emp-1', 'actor-1');

      expect(email.send).toHaveBeenCalledWith(
        expect.objectContaining({ to: 'jane@co.com' }),
      );
      expect(result.emailSent).toBe(true);
    });

    it('this task: reports emailSent=false without throwing when the reminder email fails to send', async () => {
      prisma.employee.findUnique.mockResolvedValue({
        id: 'emp-1',
        status: EmployeeStatus.INVITED,
        workEmail: 'jane@co.com',
        firstName: 'Jane',
      });
      email.send.mockResolvedValue({ sent: false });

      const result = await service.resendInvitation('emp-1', 'actor-1');

      expect(result.emailSent).toBe(false);
      // The invitation record must still be (re)issued even though the
      // email failed — a resend failure must never roll back the new token.
      expect(prisma.employeeInvitation.create).toHaveBeenCalled();
    });
  });

  describe('Auth Phase 2: account activation', () => {
    it('activates on a valid token: sets passwordHash + ACTIVE status, marks the token used', async () => {
      const tokenHash = hashInvitationToken('raw-token-abc');
      prisma.employeeInvitation.findUnique.mockResolvedValue({
        id: 'inv-1',
        employeeId: 'emp-1',
        tokenHash,
        usedAt: null,
        expiresAt: new Date(Date.now() + 60_000),
        employee: { status: EmployeeStatus.INVITED },
      });
      prisma.employee.update.mockReturnValue({ id: 'emp-1' });
      prisma.employeeInvitation.update.mockReturnValue({ id: 'inv-1' });
      prisma.$transaction.mockResolvedValue([{}, {}]);

      const result = await service.activateAccount({
        token: 'raw-token-abc',
        password: 'SuperSecret1!',
        confirmPassword: 'SuperSecret1!',
      });

      expect(result).toEqual({ success: true });
      expect(prisma.$transaction).toHaveBeenCalled();
      expect(prisma.employee.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'emp-1' },
          data: expect.objectContaining({ status: EmployeeStatus.ACTIVE }),
        }),
      );
      const [employeeUpdate, invitationUpdate] =
        prisma.$transaction.mock.calls[0][0];
      expect(employeeUpdate).toBeDefined();
      expect(invitationUpdate).toBeDefined();
    });

    it('rejects when password and confirmPassword do not match', async () => {
      await expect(
        service.activateAccount({
          token: 'raw-token-abc',
          password: 'SuperSecret1!',
          confirmPassword: 'Different1!',
        }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.employeeInvitation.findUnique).not.toHaveBeenCalled();
    });

    it('rejects an invalid/unknown token', async () => {
      prisma.employeeInvitation.findUnique.mockResolvedValue(null);
      await expect(
        service.activateAccount({
          token: 'nope',
          password: 'SuperSecret1!',
          confirmPassword: 'SuperSecret1!',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects an already-used token', async () => {
      prisma.employeeInvitation.findUnique.mockResolvedValue({
        id: 'inv-1',
        employeeId: 'emp-1',
        tokenHash: hashInvitationToken('used-token'),
        usedAt: new Date(),
        expiresAt: new Date(Date.now() + 60_000),
        employee: { status: EmployeeStatus.ACTIVE },
      });
      await expect(
        service.activateAccount({
          token: 'used-token',
          password: 'SuperSecret1!',
          confirmPassword: 'SuperSecret1!',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects an expired token', async () => {
      prisma.employeeInvitation.findUnique.mockResolvedValue({
        id: 'inv-1',
        employeeId: 'emp-1',
        tokenHash: hashInvitationToken('expired-token'),
        usedAt: null,
        expiresAt: new Date(Date.now() - 60_000),
        employee: { status: EmployeeStatus.INVITED },
      });
      await expect(
        service.activateAccount({
          token: 'expired-token',
          password: 'SuperSecret1!',
          confirmPassword: 'SuperSecret1!',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('this task: rejects activation via an old invitation once the employee has been terminated', async () => {
      prisma.employeeInvitation.findUnique.mockResolvedValue({
        id: 'inv-1',
        employeeId: 'emp-1',
        tokenHash: hashInvitationToken('terminated-token'),
        usedAt: null,
        expiresAt: new Date(Date.now() + 60_000),
        employee: { status: EmployeeStatus.TERMINATED },
      });
      await expect(
        service.activateAccount({
          token: 'terminated-token',
          password: 'SuperSecret1!',
          confirmPassword: 'SuperSecret1!',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('validateInvitationToken returns only safe identity fields for a valid token', async () => {
      prisma.employeeInvitation.findUnique.mockResolvedValue({
        id: 'inv-1',
        employeeId: 'emp-1',
        tokenHash: hashInvitationToken('raw-token-xyz'),
        usedAt: null,
        expiresAt: new Date(Date.now() + 60_000),
        employee: {
          firstName: 'Jane',
          lastName: 'Doe',
          employeeCode: 'EMP-1',
          workEmail: 'jane@co.com',
          passwordHash: 'should-not-appear',
        },
      });

      const result = await service.validateInvitationToken('raw-token-xyz');

      expect(result).toEqual({
        firstName: 'Jane',
        lastName: 'Doe',
        employeeCode: 'EMP-1',
        email: 'jane@co.com',
        expiresAt: expect.any(Date),
      });
      expect(
        (result as { passwordHash?: string }).passwordHash,
      ).toBeUndefined();
    });
  });

  describe('Auth Phase 3: getMyProfile', () => {
    it('returns the employee, completion info, and never passwordHash', async () => {
      prisma.employee.findUnique.mockResolvedValue({
        id: 'emp-1',
        dob: null,
        gender: null,
        phone: null,
        addressLine: null,
        city: null,
        state: null,
        postalCode: null,
        pan: null,
        bankAccountNumber: null,
        emergencyContactName: null,
        emergencyContactPhone: null,
        passwordHash: 'super-secret-hash',
      });

      const result = await service.getMyProfile('emp-1');

      expect(result.completionPercentage).toBe(0);
      expect(result.isComplete).toBe(false);
      expect(
        (result.employee as { passwordHash?: string }).passwordHash,
      ).toBeUndefined();
    });

    it('throws NotFoundException for a missing employee id', async () => {
      prisma.employee.findUnique.mockResolvedValue(null);
      await expect(service.getMyProfile('missing')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('is scoped to the id passed in — never a param the caller does not control', async () => {
      prisma.employee.findUnique.mockResolvedValue({ id: 'emp-1' });
      await service.getMyProfile('emp-1');
      expect(prisma.employee.findUnique).toHaveBeenCalledWith({
        where: { id: 'emp-1' },
      });
    });
  });

  describe('Auth Phase 3: updateMyProfile', () => {
    it('writes only whitelisted fields and returns updated completion', async () => {
      prisma.employee.update.mockResolvedValue({
        id: 'emp-1',
        dob: new Date('1990-01-01'),
        gender: 'MALE',
        phone: '9999999999',
        addressLine: '123 Main St',
        city: 'Bengaluru',
        state: 'Karnataka',
        postalCode: '560001',
        pan: 'ABCDE1234F',
        bankAccountNumber: '000111222333',
        emergencyContactName: 'John Doe',
        emergencyContactPhone: '8888888888',
      });

      const result = await service.updateMyProfile('emp-1', {
        dob: '1990-01-01',
        phone: '9999999999',
      });

      expect(prisma.employee.update).toHaveBeenCalledWith({
        where: { id: 'emp-1' },
        data: expect.objectContaining({ phone: '9999999999' }),
      });
      expect(result.completionPercentage).toBeGreaterThan(0);
    });

    it('SECURITY: ignores role/departmentId/companyId/reportingManagerId/status even if somehow present on the dto object', async () => {
      prisma.employee.update.mockResolvedValue({ id: 'emp-1' });

      const maliciousDto = {
        phone: '9999999999',
        role: 'SUPER_ADMIN',
        departmentId: 'dept-evil',
        companyId: 'company-evil',
        reportingManagerId: 'mgr-evil',
        status: 'ACTIVE',
      } as unknown as Parameters<typeof service.updateMyProfile>[1];

      await service.updateMyProfile('emp-1', maliciousDto);

      const updateArg = prisma.employee.update.mock.calls[0][0];
      expect(updateArg.data).not.toHaveProperty('role');
      expect(updateArg.data).not.toHaveProperty('departmentId');
      expect(updateArg.data).not.toHaveProperty('companyId');
      expect(updateArg.data).not.toHaveProperty('reportingManagerId');
      expect(updateArg.data).not.toHaveProperty('status');
      expect(updateArg.data).not.toHaveProperty('employeeCode');
      expect(updateArg.data).not.toHaveProperty('passwordHash');
    });

    it('SECURITY: passwordHash cannot be set through this endpoint even if present on the dto object', async () => {
      prisma.employee.update.mockResolvedValue({ id: 'emp-1' });
      const maliciousDto = {
        passwordHash: 'attacker-controlled-hash',
      } as unknown as Parameters<typeof service.updateMyProfile>[1];

      await service.updateMyProfile('emp-1', maliciousDto);

      const updateArg = prisma.employee.update.mock.calls[0][0];
      expect(updateArg.data).not.toHaveProperty('passwordHash');
    });

    it('never returns passwordHash after an update', async () => {
      prisma.employee.update.mockResolvedValue({
        id: 'emp-1',
        passwordHash: 'super-secret-hash',
      });
      const result = await service.updateMyProfile('emp-1', { phone: '123' });
      expect(
        (result.employee as { passwordHash?: string }).passwordHash,
      ).toBeUndefined();
    });

    it('scopes the write to the given employeeId only', async () => {
      prisma.employee.update.mockResolvedValue({ id: 'emp-1' });
      await service.updateMyProfile('emp-1', { phone: '123' });
      expect(prisma.employee.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'emp-1' } }),
      );
    });
  });

  describe('This task: employee dismissal/termination', () => {
    it('sets status to TERMINATED and invalidates any unused invitation, without deleting the record', async () => {
      prisma.employee.findUnique.mockResolvedValue({
        id: 'emp-1',
        status: EmployeeStatus.ACTIVE,
        employeeCode: 'EMP-1',
      });
      prisma.$transaction.mockResolvedValue([
        {
          id: 'emp-1',
          employeeCode: 'EMP-1',
          status: EmployeeStatus.TERMINATED,
        },
        { count: 1 },
      ]);

      const result = await service.dismissEmployee('emp-1', 'actor-1');

      const ops = prisma.$transaction.mock.calls[0][0];
      expect(ops).toHaveLength(2);
      expect(prisma.employee.update).toHaveBeenCalledWith({
        where: { id: 'emp-1' },
        data: { status: EmployeeStatus.TERMINATED },
      });
      expect(prisma.employeeInvitation.deleteMany).toHaveBeenCalledWith({
        where: { employeeId: 'emp-1', usedAt: null },
      });
      expect(result.status).toBe(EmployeeStatus.TERMINATED);
      expect(result.employeeCode).toBe('EMP-1');
      expect(
        (result as { passwordHash?: string }).passwordHash,
      ).toBeUndefined();
    });

    it('rejects dismissing an already-terminated employee (idempotency guard)', async () => {
      prisma.employee.findUnique.mockResolvedValue({
        id: 'emp-1',
        status: EmployeeStatus.TERMINATED,
      });
      await expect(service.dismissEmployee('emp-1', 'actor-1')).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('throws NotFoundException for an unknown employee', async () => {
      prisma.employee.findUnique.mockResolvedValue(null);
      await expect(
        service.dismissEmployee('missing', 'actor-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('never hard-deletes the employee record', async () => {
      prisma.employee.findUnique.mockResolvedValue({
        id: 'emp-1',
        status: EmployeeStatus.ACTIVE,
      });
      prisma.$transaction.mockResolvedValue([
        { id: 'emp-1', status: EmployeeStatus.TERMINATED },
        { count: 0 },
      ]);
      await service.dismissEmployee('emp-1', 'actor-1');
      // deleteEmployee() (below) is the only method that ever calls
      // employee.delete — dismiss must never reach it.
      expect(prisma.employee.delete).not.toHaveBeenCalled();
    });
  });

  describe('This task: Super Admin-only permanent delete (test/dev cleanup, separate from dismiss)', () => {
    it('throws NotFoundException for an unknown employee', async () => {
      prisma.employee.findUnique.mockResolvedValue(null);
      await expect(service.deleteEmployee('missing')).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('with no references at all: clears every employee-owned table and deletes the employee row, scoped to that employee only', async () => {
      prisma.employee.findUnique.mockResolvedValue({
        id: 'emp-1',
        employeeCode: 'EMP-2026-0010',
      });

      const result = await service.deleteEmployee('emp-1');

      expect(prisma.employeeInvitation.deleteMany).toHaveBeenCalledWith({
        where: { employeeId: 'emp-1' },
      });
      expect(prisma.attendanceRecord.deleteMany).toHaveBeenCalledWith({
        where: { employeeId: 'emp-1' },
      });
      expect(prisma.notification.deleteMany).toHaveBeenCalledWith({
        where: { employeeId: 'emp-1' },
      });
      expect(prisma.employee.delete).toHaveBeenCalledWith({
        where: { id: 'emp-1' },
      });
      expect(result).toEqual({ deleted: true, employeeCode: 'EMP-2026-0010' });
    });

    // Regression: several employee-owned models have their own child rows
    // that reference THEM (by resignationId/checklistId/applicationId/
    // conversationId), not the employee directly — deleting the parent row
    // without clearing these first violates a foreign-key constraint one
    // level down (caught via live browser testing against Test 2, not unit
    // tests alone, since the mock wouldn't have surfaced a real FK error).
    it('clears grandchild rows (ClearanceItem/LwdAdjustment via Resignation, ChecklistTask via OnboardingChecklist, LeaveApprovalStep via LeaveApplication, AssistantMessage via AssistantConversation) before deleting their parents', async () => {
      prisma.employee.findUnique.mockResolvedValue({
        id: 'emp-1',
        employeeCode: 'EMP-2026-0010',
      });
      prisma.resignation.findUnique.mockResolvedValue({ id: 'resignation-1' });
      prisma.onboardingChecklist.findUnique.mockResolvedValue({ id: 'checklist-1' });
      prisma.leaveApplication.findMany.mockResolvedValue([{ id: 'leave-1' }, { id: 'leave-2' }]);
      prisma.assistantConversation.findMany.mockResolvedValue([{ id: 'conv-1' }]);

      await service.deleteEmployee('emp-1');

      expect(prisma.clearanceItem.deleteMany).toHaveBeenCalledWith({
        where: { resignationId: 'resignation-1' },
      });
      expect(prisma.lwdAdjustment.deleteMany).toHaveBeenCalledWith({
        where: { resignationId: 'resignation-1' },
      });
      expect(prisma.checklistTask.deleteMany).toHaveBeenCalledWith({
        where: { checklistId: 'checklist-1' },
      });
      expect(prisma.leaveApprovalStep.deleteMany).toHaveBeenCalledWith({
        where: { applicationId: { in: ['leave-1', 'leave-2'] } },
      });
      expect(prisma.assistantMessage.deleteMany).toHaveBeenCalledWith({
        where: { conversationId: { in: ['conv-1'] } },
      });
      expect(prisma.employee.delete).toHaveBeenCalledWith({ where: { id: 'emp-1' } });
    });

    it('skips grandchild cleanup calls when there is nothing to clean up (no Resignation/Checklist/leave applications/conversations)', async () => {
      prisma.employee.findUnique.mockResolvedValue({
        id: 'emp-1',
        employeeCode: 'EMP-2026-0010',
      });
      // Defaults: findUnique -> undefined, findMany -> [] (see createMockPrisma)

      await service.deleteEmployee('emp-1');

      expect(prisma.clearanceItem.deleteMany).not.toHaveBeenCalled();
      expect(prisma.lwdAdjustment.deleteMany).not.toHaveBeenCalled();
      expect(prisma.checklistTask.deleteMany).not.toHaveBeenCalled();
      expect(prisma.leaveApprovalStep.deleteMany).not.toHaveBeenCalled();
      expect(prisma.assistantMessage.deleteMany).not.toHaveBeenCalled();
      expect(prisma.employee.delete).toHaveBeenCalledWith({ where: { id: 'emp-1' } });
    });

    it('reporting-manager reference: clears it to NULL on other employees rather than blocking the delete', async () => {
      prisma.employee.findUnique.mockResolvedValue({
        id: 'mgr-1',
        employeeCode: 'EMP-1',
      });

      const result = await service.deleteEmployee('mgr-1');

      expect(prisma.employee.updateMany).toHaveBeenCalledWith({
        where: { reportingManagerId: 'mgr-1' },
        data: { reportingManagerId: null },
      });
      expect(prisma.employee.delete).toHaveBeenCalledWith({ where: { id: 'mgr-1' } });
      expect(result).toEqual({ deleted: true, employeeCode: 'EMP-1' });
    });

    it('nullable secondary-role references (ticket agent, SLA policy agent, asset request approver): cleared to NULL, delete succeeds', async () => {
      prisma.employee.findUnique.mockResolvedValue({
        id: 'agent-1',
        employeeCode: 'EMP-1',
      });

      await service.deleteEmployee('agent-1');

      expect(prisma.ticket.updateMany).toHaveBeenCalledWith({
        where: { assignedAgentId: 'agent-1' },
        data: { assignedAgentId: null },
      });
      expect(prisma.ticketSlaPolicy.updateMany).toHaveBeenCalledWith({
        where: { agentId: 'agent-1' },
        data: { agentId: null },
      });
      expect(prisma.assetRequest.updateMany).toHaveBeenCalledWith({
        where: { approverId: 'agent-1' },
        data: { approverId: null },
      });
      expect(prisma.employee.delete).toHaveBeenCalledWith({ where: { id: 'agent-1' } });
    });

    it('blocks deletion with a specific error when the employee is a required hiring manager on a job requisition — no write happens', async () => {
      prisma.employee.findUnique.mockResolvedValue({
        id: 'mgr-1',
        firstName: 'Test',
        lastName: '2',
        employeeCode: 'EMP-1',
      });
      prisma.jobRequisition.count.mockResolvedValue(2);

      await expect(service.deleteEmployee('mgr-1')).rejects.toThrow(
        new BadRequestException(
          'Cannot delete Test 2. The employee is referenced as a required job requisition (as hiring manager) by 2 records. Reassign or remove those references before deleting.',
        ),
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(prisma.employee.delete).not.toHaveBeenCalled();
    });

    it('blocks deletion when the employee raised a helpdesk ticket (preserved business record) rather than deleting or nulling it', async () => {
      prisma.employee.findUnique.mockResolvedValue({
        id: 'emp-1',
        firstName: 'Test',
        lastName: '2',
        employeeCode: 'EMP-1',
      });
      prisma.ticket.count.mockResolvedValue(1);

      await expect(service.deleteEmployee('emp-1')).rejects.toThrow(
        /referenced as a required helpdesk ticket \(raised by this employee\) by 1 record\b/,
      );
      expect(prisma.ticket.deleteMany).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('blocks deletion when the employee made a required workflow approval decision (audit trail preserved)', async () => {
      prisma.employee.findUnique.mockResolvedValue({
        id: 'emp-1',
        firstName: 'Test',
        lastName: '2',
        employeeCode: 'EMP-1',
      });
      prisma.workflowApprovalDecision.count.mockResolvedValue(3);

      await expect(service.deleteEmployee('emp-1')).rejects.toThrow(
        /workflow approval decision \(as approver\) by 3 records/,
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('lists every blocking reference together when more than one applies', async () => {
      prisma.employee.findUnique.mockResolvedValue({
        id: 'emp-1',
        firstName: 'Test',
        lastName: '2',
        employeeCode: 'EMP-1',
      });
      prisma.jobRequisition.count.mockResolvedValue(1);
      prisma.ticket.count.mockResolvedValue(2);

      await expect(service.deleteEmployee('emp-1')).rejects.toThrow(
        /job requisition.*helpdesk ticket|helpdesk ticket.*job requisition/s,
      );
    });

    it('performance records (goal/review/monthly evaluation) block deletion rather than being silently deleted', async () => {
      prisma.employee.findUnique.mockResolvedValue({
        id: 'emp-1',
        firstName: 'Test',
        lastName: '2',
        employeeCode: 'EMP-1',
      });
      prisma.review.count.mockResolvedValue(1);

      await expect(service.deleteEmployee('emp-1')).rejects.toThrow(
        /performance review by 1 record/,
      );
      expect(prisma.review.deleteMany).not.toHaveBeenCalled();
    });
  });

  describe('This task: admin employee-profile completion (reuses Auth Phase 3 calculation)', () => {
    it('a SUPER_ADMIN can view another employee’s completion breakdown', async () => {
      prisma.employee.findUnique.mockResolvedValue({
        id: 'emp-2',
        dob: null,
        gender: null,
        phone: null,
        addressLine: null,
        city: null,
        state: null,
        postalCode: null,
        pan: null,
        bankAccountNumber: null,
        emergencyContactName: null,
        emergencyContactPhone: null,
      });

      const result = await service.getProfileCompletionForEmployee('emp-2', {
        userId: 'admin-1',
        role: Role.SUPER_ADMIN,
      });

      expect(result.completionPercentage).toBe(0);
      expect(result.isComplete).toBe(false);
      expect(result.missingFields.length).toBeGreaterThan(0);
    });

    it('a plain EMPLOYEE cannot view another employee’s completion breakdown', async () => {
      await expect(
        service.getProfileCompletionForEmployee('emp-2', {
          userId: 'emp-3',
          role: Role.EMPLOYEE,
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('an employee can view their own completion breakdown', async () => {
      prisma.employee.findUnique.mockResolvedValue({
        id: 'emp-3',
        dob: new Date('1990-01-01'),
        gender: Gender.FEMALE,
        phone: '9999999999',
        addressLine: 'Line 1',
        city: 'City',
        state: 'State',
        postalCode: '000000',
        pan: 'ABCDE1234F',
        bankAccountNumber: '123456',
        emergencyContactName: 'Contact',
        emergencyContactPhone: '8888888888',
      });

      const result = await service.getProfileCompletionForEmployee('emp-3', {
        userId: 'emp-3',
        role: Role.EMPLOYEE,
      });

      expect(result.isComplete).toBe(true);
    });
  });
});
