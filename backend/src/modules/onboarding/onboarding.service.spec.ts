import { BadRequestException, NotFoundException } from '@nestjs/common';
import { OnboardingService } from './onboarding.service';
import { PrismaService } from '../../shared/database/prisma.service';
import { DefaultCompanyService } from '../../shared/database/default-company.service';
import { NotificationService } from '../../shared/notifications/notification.service';
import { MagicLinkService } from '../../shared/auth/magic-link.service';

function createMockPrisma() {
  return {
    onboardingChecklistTemplate: {
      create: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
    },
    onboardingChecklist: {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      findMany: jest.fn(),
    },
    checklistTask: {
      findUnique: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    },
    employee: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    employeeHistory: {
      create: jest.fn(),
    },
    preboardingSubmission: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
  };
}

function createMockNotifications() {
  return { send: jest.fn().mockResolvedValue(undefined) };
}

function createMockMagicLink() {
  return { sign: jest.fn().mockReturnValue('signed-token'), verify: jest.fn() };
}

describe('OnboardingService', () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let notifications: ReturnType<typeof createMockNotifications>;
  let magicLink: ReturnType<typeof createMockMagicLink>;
  let service: OnboardingService;

  beforeEach(() => {
    prisma = createMockPrisma();
    notifications = createMockNotifications();
    magicLink = createMockMagicLink();
    service = new OnboardingService(
      prisma as unknown as PrismaService,
      { getOrCreate: jest.fn() } as unknown as DefaultCompanyService,
      notifications as unknown as NotificationService,
      magicLink as unknown as MagicLinkService,
    );
  });

  describe('Key Feature: checklists are auto-assigned on hire from a role/department template', () => {
    it('returns the existing checklist instead of failing when already initialized', async () => {
      prisma.onboardingChecklist.findUnique.mockResolvedValue({
        id: 'checklist-1',
        tasks: [],
      });

      const result = await service.initChecklist('emp-1');
      expect(result.id).toBe('checklist-1');
      expect(prisma.employee.findUnique).not.toHaveBeenCalled();
    });

    it('throws when no template is configured for the department', async () => {
      prisma.onboardingChecklist.findUnique.mockResolvedValue(null);
      prisma.employee.findUnique.mockResolvedValue({
        id: 'emp-1',
        companyId: 'co-1',
        departmentId: 'dept-1',
        dateOfJoining: null,
        reportingManagerId: null,
      });
      prisma.onboardingChecklistTemplate.findFirst.mockResolvedValue(null);

      await expect(service.initChecklist('emp-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('snapshots the template’s tasks onto a new checklist and notifies owners', async () => {
      prisma.onboardingChecklist.findUnique.mockResolvedValue(null);
      prisma.employee.findUnique.mockResolvedValue({
        id: 'emp-1',
        companyId: 'co-1',
        departmentId: 'dept-1',
        dateOfJoining: new Date('2026-09-01'),
        reportingManagerId: 'mgr-1',
      });
      prisma.onboardingChecklistTemplate.findFirst.mockResolvedValueOnce({
        id: 'tmpl-1',
        taskTemplates: [
          {
            ownerRole: 'NEW_HIRE',
            description: 'Submit ID proof',
            dueOffsetDays: 0,
          },
          {
            ownerRole: 'MANAGER',
            description: 'Welcome new hire',
            dueOffsetDays: 1,
          },
        ],
      });
      prisma.onboardingChecklist.create.mockResolvedValue({
        id: 'checklist-1',
        tasks: [{ ownerRole: 'NEW_HIRE' }, { ownerRole: 'MANAGER' }],
      });

      const result = await service.initChecklist('emp-1');

      expect(result.id).toBe('checklist-1');
      expect(notifications.send).toHaveBeenCalledWith(
        expect.objectContaining({
          recipientId: 'emp-1',
          template: 'onboarding.checklist-created',
        }),
      );
      expect(notifications.send).toHaveBeenCalledWith(
        expect.objectContaining({ recipientId: 'mgr-1' }),
      );
    });
  });

  describe('Access control: only the right role can complete a checklist task', () => {
    it('rejects completing a new-hire task through the staff endpoint', async () => {
      prisma.checklistTask.findUnique.mockResolvedValue({
        id: 'task-1',
        ownerRole: 'NEW_HIRE',
        status: 'PENDING',
        checklistId: 'checklist-1',
      });

      await expect(
        service.completeTask('task-1', 'actor-1', 'HR_ADMIN'),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a non-manager completing a manager-owned task', async () => {
      prisma.checklistTask.findUnique.mockResolvedValue({
        id: 'task-1',
        ownerRole: 'MANAGER',
        status: 'PENDING',
        checklistId: 'checklist-1',
      });

      await expect(
        service.completeTask('task-1', 'actor-1', 'EMPLOYEE'),
      ).rejects.toThrow(BadRequestException);
    });

    it("rejects a manager who isn't this new hire's assigned manager", async () => {
      prisma.checklistTask.findUnique.mockResolvedValue({
        id: 'task-1',
        ownerRole: 'MANAGER',
        status: 'PENDING',
        checklistId: 'checklist-1',
        checklist: { employee: { reportingManagerId: 'mgr-assigned' } },
      });

      await expect(
        service.completeTask('task-1', 'mgr-other', 'MANAGER'),
      ).rejects.toThrow(BadRequestException);
    });

    it('allows the actually-assigned manager to complete a manager-owned task', async () => {
      prisma.checklistTask.findUnique.mockResolvedValue({
        id: 'task-1',
        ownerRole: 'MANAGER',
        status: 'PENDING',
        checklistId: 'checklist-1',
        checklist: { employee: { reportingManagerId: 'mgr-assigned' } },
      });
      prisma.checklistTask.update.mockResolvedValue({
        id: 'task-1',
        status: 'COMPLETED',
      });
      prisma.checklistTask.count.mockResolvedValue(1);

      await expect(
        service.completeTask('task-1', 'mgr-assigned', 'MANAGER'),
      ).resolves.toEqual({ id: 'task-1', status: 'COMPLETED' });
    });

    it('marks the checklist complete once its last task is done', async () => {
      prisma.checklistTask.findUnique.mockResolvedValue({
        id: 'task-1',
        ownerRole: 'HR',
        status: 'PENDING',
        checklistId: 'checklist-1',
      });
      prisma.checklistTask.update.mockResolvedValue({
        id: 'task-1',
        status: 'COMPLETED',
      });
      prisma.checklistTask.count.mockResolvedValue(0);

      await service.completeTask('task-1', 'hr-1', 'HR_ADMIN');
      expect(prisma.onboardingChecklist.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'COMPLETED' } }),
      );
    });
  });

  describe('Preboarding portal (magic-link access)', () => {
    it('rejects completing a task that belongs to a different employee’s checklist', async () => {
      magicLink.verify.mockReturnValue({ sub: 'emp-1' });
      prisma.checklistTask.findUnique.mockResolvedValue({
        id: 'task-1',
        ownerRole: 'NEW_HIRE',
        status: 'PENDING',
        checklist: { employeeId: 'emp-2' },
      });

      await expect(
        service.completeTaskViaPortal('task-1', 'token'),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects submitting preboarding documents once the employee has left Preboarding status', async () => {
      magicLink.verify.mockReturnValue({ sub: 'emp-1' });
      prisma.employee.findUnique.mockResolvedValue({
        id: 'emp-1',
        status: 'ACTIVE_PROBATION',
      });

      await expect(
        service.submitPreboarding('token', 'ID_PROOF', 'doc-ref-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('updates an existing submission instead of creating a duplicate row', async () => {
      magicLink.verify.mockReturnValue({ sub: 'emp-1' });
      prisma.employee.findUnique.mockResolvedValue({
        id: 'emp-1',
        status: 'PREBOARDING',
      });
      prisma.preboardingSubmission.findFirst.mockResolvedValue({ id: 'sub-1' });
      prisma.preboardingSubmission.update.mockResolvedValue({
        id: 'sub-1',
        valueRef: 'new-ref',
      });

      await service.submitPreboarding('token', 'ID_PROOF', 'new-ref');
      expect(prisma.preboardingSubmission.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'sub-1' } }),
      );
      expect(prisma.preboardingSubmission.create).not.toHaveBeenCalled();
    });
  });

  describe("Business Rule: status cannot move from 'Preboarding' to 'Active' until all mandatory items are complete", () => {
    it('rejects activation when mandatory preboarding fields are missing', async () => {
      prisma.employee.findUnique.mockResolvedValue({
        id: 'emp-1',
        status: 'PREBOARDING',
      });
      prisma.preboardingSubmission.findMany.mockResolvedValue([
        { fieldType: 'ID_PROOF' },
      ]);

      await expect(service.activateEmployee('emp-1', 'hr-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('activates the employee once every mandatory field has been submitted', async () => {
      prisma.employee.findUnique.mockResolvedValue({
        id: 'emp-1',
        status: 'PREBOARDING',
      });
      prisma.preboardingSubmission.findMany.mockResolvedValue([
        { fieldType: 'ID_PROOF' },
        { fieldType: 'EDUCATION_CERTIFICATE' },
        { fieldType: 'BANK_DETAILS' },
        { fieldType: 'BACKGROUND_CHECK_CONSENT' },
      ]);

      const result = await service.activateEmployee('emp-1', 'hr-1');
      expect(result.status).toBe('ACTIVE_PROBATION');
      expect(prisma.$transaction).toHaveBeenCalled();
    });

    it("this task: also closes out the employee's checklist, so it stops appearing in listActiveChecklists() and a second click can't hit 'not in Preboarding status'", async () => {
      prisma.employee.findUnique.mockResolvedValue({
        id: 'emp-1',
        status: 'PREBOARDING',
      });
      prisma.preboardingSubmission.findMany.mockResolvedValue([
        { fieldType: 'ID_PROOF' },
        { fieldType: 'EDUCATION_CERTIFICATE' },
        { fieldType: 'BANK_DETAILS' },
        { fieldType: 'BACKGROUND_CHECK_CONSENT' },
      ]);

      await service.activateEmployee('emp-1', 'hr-1');

      expect(prisma.onboardingChecklist.updateMany).toHaveBeenCalledWith({
        where: { employeeId: 'emp-1', status: { not: 'COMPLETED' } },
        data: { status: 'COMPLETED' },
      });
    });

    it('rejects re-activating an employee who is already past Preboarding', async () => {
      prisma.employee.findUnique.mockResolvedValue({
        id: 'emp-1',
        status: 'ACTIVE_PROBATION',
      });

      await expect(service.activateEmployee('emp-1', 'hr-1')).rejects.toThrow(
        'This employee is not in Preboarding status',
      );
    });
  });
});
