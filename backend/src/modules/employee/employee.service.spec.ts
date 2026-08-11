import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { EmployeeStatus, Gender, Prisma, Role } from '@prisma/client';
import { EmployeeService } from './employee.service';
import { PrismaService } from '../../shared/database/prisma.service';
import { NotificationService } from '../../shared/notifications/notification.service';

function createMockPrisma() {
  return {
    employee: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      findUniqueOrThrow: jest.fn(),
    },
    employeeHistory: {
      createMany: jest.fn(),
      create: jest.fn(),
    },
    profileChangeRequest: {
      create: jest.fn(),
      createMany: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    company: {
      findFirst: jest.fn(),
      create: jest.fn(),
    },
    $transaction: jest.fn(),
  };
}

function createMockNotifications() {
  return { send: jest.fn().mockResolvedValue(undefined) };
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
  let service: EmployeeService;

  beforeEach(() => {
    prisma = createMockPrisma();
    notifications = createMockNotifications();
    service = new EmployeeService(
      prisma as unknown as PrismaService,
      notifications as unknown as NotificationService,
    );
    prisma.company.findFirst.mockResolvedValue({ id: 'company-1' });
    prisma.employee.count.mockResolvedValue(0);
  });

  describe('employee code generation (Business Rule: system-generated, unique, immutable)', () => {
    it('generates a code in the EMP-<year>-<seq> format', async () => {
      prisma.employee.create.mockResolvedValue({
        id: 'emp-1',
        employeeCode: 'EMP-2026-0001',
      });

      await service.create(VALID_ACTIVE_FIELDS, 'actor-1');

      const createArgs = prisma.employee.create.mock.calls[0][0];
      expect(createArgs.data.employeeCode).toMatch(/^EMP-\d{4}-0001$/);
    });

    it('retries with a new code on a unique-constraint collision', async () => {
      const conflictError = new Prisma.PrismaClientKnownRequestError(
        'Unique constraint failed',
        { code: 'P2002', clientVersion: '6.0.0' },
      );
      prisma.employee.create
        .mockRejectedValueOnce(conflictError)
        .mockResolvedValueOnce({ id: 'emp-1', employeeCode: 'EMP-2026-0002' });
      prisma.employee.count.mockResolvedValueOnce(0).mockResolvedValueOnce(1);

      const result = await service.create(VALID_ACTIVE_FIELDS, 'actor-1');

      expect(prisma.employee.create).toHaveBeenCalledTimes(2);
      expect(result.employeeCode).toBe('EMP-2026-0002');
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

    it('treats a new hire\'s own PAN/bank/IFSC/blood-group entry as a self-service change request too', async () => {
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
          bloodGroup: 'O_POSITIVE' as never,
        },
        { userId: 'emp-1', role: Role.EMPLOYEE },
      );

      expect(prisma.employee.update).not.toHaveBeenCalled();
      expect(prisma.profileChangeRequest.createMany).toHaveBeenCalledWith({
        data: expect.arrayContaining([
          expect.objectContaining({ fieldName: 'pan', newValue: 'ABCDE1234F' }),
          expect.objectContaining({ fieldName: 'bloodGroup', newValue: 'O_POSITIVE' }),
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

  describe('Section 6 data-scope: an Employee only sees their own record in the directory list', () => {
    it('returns just the requester\'s own record for an EMPLOYEE, ignoring list filters', async () => {
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

      const result = await service.findAll({}, { userId: 'emp-1', role: Role.EMPLOYEE });

      expect(result.items).toEqual([]);
      expect(result.total).toBe(0);
    });

    it('still returns the full directory for HR Admin', async () => {
      prisma.employee.findMany.mockResolvedValue([{ id: 'emp-1' }, { id: 'emp-2' }]);
      prisma.employee.count.mockResolvedValueOnce(2);

      const result = await service.findAll({}, { userId: 'hr-1', role: Role.HR_ADMIN });

      expect(prisma.employee.findUnique).not.toHaveBeenCalled();
      expect(result.items).toHaveLength(2);
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
});
