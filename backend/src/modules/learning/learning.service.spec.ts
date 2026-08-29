import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { LearningService } from './learning.service';
import { PrismaService } from '../../shared/database/prisma.service';
import { NotificationService } from '../../shared/notifications/notification.service';

function createMockPrisma() {
  return {
    employee: { findUnique: jest.fn(), findMany: jest.fn() },
    learningRequest: {
      create: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  };
}

function createMockNotifications() {
  return { send: jest.fn().mockResolvedValue(undefined) };
}

describe('LearningService', () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let notifications: ReturnType<typeof createMockNotifications>;
  let service: LearningService;

  beforeEach(() => {
    prisma = createMockPrisma();
    notifications = createMockNotifications();
    service = new LearningService(
      prisma as unknown as PrismaService,
      notifications as unknown as NotificationService,
    );
  });

  describe('Spend limit: CTC-tiered annual cap', () => {
    it.each([
      [10, 30000],
      [20, 40000],
      [30, 55000],
      [40, 70000],
    ])('gives an employee on %d LPA an annual cap of %d', async (ctcLpa, expected) => {
      prisma.employee.findUnique.mockResolvedValue({ id: 'emp-1', ctcLpa });
      prisma.learningRequest.findMany.mockResolvedValue([]);

      const result = await service.getMySpendLimit('emp-1');
      expect(result.annualLimit).toBe(expected);
      expect(result.remaining).toBe(expected);
    });

    it('subtracts every non-rejected request this year from the remaining amount', async () => {
      prisma.employee.findUnique.mockResolvedValue({ id: 'emp-1', ctcLpa: 10 });
      prisma.learningRequest.findMany.mockResolvedValue([{ cost: 5000 }, { cost: 2000 }]);

      const result = await service.getMySpendLimit('emp-1');
      expect(result.used).toBe(7000);
      expect(result.remaining).toBe(23000);
    });

    it('rejects computing a limit for an employee with no CTC on file', async () => {
      prisma.employee.findUnique.mockResolvedValue({ id: 'emp-1', ctcLpa: null });

      await expect(service.getMySpendLimit('emp-1')).rejects.toThrow(BadRequestException);
    });
  });

  describe('submitRequest', () => {
    const dto = {
      courseName: 'Advanced React',
      duration: '6 weeks',
      purpose: 'Frontend upskilling',
      organizationalImpact: 'Faster feature delivery',
      cost: 10000,
      timeCommitment: '5 hours/week',
    };

    it('rejects a request that exceeds the remaining budget', async () => {
      prisma.employee.findUnique.mockResolvedValue({
        id: 'emp-1',
        ctcLpa: 10,
        reportingManagerId: 'mgr-1',
      });
      prisma.learningRequest.findMany.mockResolvedValue([{ cost: 25000 }]); // only 5000 left

      await expect(
        service.submitRequest('emp-1', dto, Role.EMPLOYEE),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.learningRequest.create).not.toHaveBeenCalled();
    });

    it('starts at PENDING_MANAGER and notifies the manager plus every Super Admin (FYI)', async () => {
      prisma.employee.findUnique.mockResolvedValue({
        id: 'emp-1',
        firstName: 'Jane',
        lastName: 'Doe',
        ctcLpa: 10,
        reportingManagerId: 'mgr-1',
      });
      prisma.employee.findMany.mockResolvedValue([{ id: 'sa-1' }, { id: 'sa-2' }]);
      prisma.learningRequest.create.mockResolvedValue({ id: 'req-1', ...dto });

      await service.submitRequest('emp-1', dto, Role.EMPLOYEE);

      expect(prisma.learningRequest.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'PENDING_MANAGER', approverId: 'mgr-1' }),
        }),
      );
      expect(notifications.send).toHaveBeenCalledWith(
        expect.objectContaining({ recipientId: 'mgr-1', template: 'learning.request-submitted' }),
      );
      expect(notifications.send).toHaveBeenCalledWith(
        expect.objectContaining({ recipientId: 'sa-1', template: 'learning.request-submitted-fyi' }),
      );
    });

    it('skips straight to PENDING_SUPER_ADMIN when the employee has no reporting manager', async () => {
      prisma.employee.findUnique.mockResolvedValue({
        id: 'emp-1',
        firstName: 'Jane',
        lastName: 'Doe',
        ctcLpa: 10,
        reportingManagerId: null,
      });
      prisma.employee.findMany.mockResolvedValue([{ id: 'sa-1' }]);
      prisma.learningRequest.create.mockResolvedValue({ id: 'req-1', ...dto });

      await service.submitRequest('emp-1', dto, Role.EMPLOYEE);

      expect(prisma.learningRequest.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'PENDING_SUPER_ADMIN', approverId: null }),
        }),
      );
    });

    it("auto-approves a Super Admin's own request with no approval chain", async () => {
      prisma.employee.findUnique.mockResolvedValue({
        id: 'sa-1',
        ctcLpa: 40,
        reportingManagerId: null,
      });
      prisma.learningRequest.create.mockResolvedValue({ id: 'req-1', status: 'APPROVED' });

      const result = await service.submitRequest('sa-1', dto, Role.SUPER_ADMIN);

      expect(result.status).toBe('APPROVED');
      expect(prisma.learningRequest.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'APPROVED',
            finalApproverId: 'sa-1',
          }),
        }),
      );
      expect(notifications.send).not.toHaveBeenCalled();
    });
  });

  describe('decide: two-stage approval', () => {
    it('rejects a decision from someone who is neither the assigned manager nor privileged', async () => {
      prisma.learningRequest.findUnique.mockResolvedValue({
        id: 'req-1',
        status: 'PENDING_MANAGER',
        approverId: 'mgr-1',
        employeeId: 'emp-1',
      });

      await expect(
        service.decide('req-1', 'someone-else', { approve: true }, Role.EMPLOYEE),
      ).rejects.toThrow(ForbiddenException);
    });

    it('manager rejection is terminal and notifies the employee', async () => {
      prisma.learningRequest.findUnique.mockResolvedValue({
        id: 'req-1',
        status: 'PENDING_MANAGER',
        approverId: 'mgr-1',
        employeeId: 'emp-1',
        courseName: 'Advanced React',
      });

      const result = await service.decide('req-1', 'mgr-1', { approve: false }, Role.MANAGER);

      expect(result.status).toBe('REJECTED');
      expect(prisma.learningRequest.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'REJECTED' }) }),
      );
      expect(notifications.send).toHaveBeenCalledWith(
        expect.objectContaining({ recipientId: 'emp-1', template: 'learning.request-rejected' }),
      );
    });

    it('manager approval moves to PENDING_SUPER_ADMIN and notifies Super Admins only, not the employee', async () => {
      prisma.learningRequest.findUnique.mockResolvedValue({
        id: 'req-1',
        status: 'PENDING_MANAGER',
        approverId: 'mgr-1',
        employeeId: 'emp-1',
        courseName: 'Advanced React',
        cost: 10000,
      });
      prisma.employee.findMany.mockResolvedValue([{ id: 'sa-1' }]);

      const result = await service.decide('req-1', 'mgr-1', { approve: true }, Role.MANAGER);

      expect(result.status).toBe('PENDING_SUPER_ADMIN');
      expect(notifications.send).toHaveBeenCalledWith(
        expect.objectContaining({ recipientId: 'sa-1', template: 'learning.request-manager-approved' }),
      );
      expect(notifications.send).not.toHaveBeenCalledWith(
        expect.objectContaining({ recipientId: 'emp-1' }),
      );
    });

    it('rejects a non-Super-Admin trying to give final approval', async () => {
      prisma.learningRequest.findUnique.mockResolvedValue({
        id: 'req-1',
        status: 'PENDING_SUPER_ADMIN',
        employeeId: 'emp-1',
      });

      await expect(
        service.decide('req-1', 'hr-1', { approve: true }, Role.HR_ADMIN),
      ).rejects.toThrow(ForbiddenException);
    });

    it('Super Admin final approval unlocks the course and notifies the employee', async () => {
      prisma.learningRequest.findUnique.mockResolvedValue({
        id: 'req-1',
        status: 'PENDING_SUPER_ADMIN',
        employeeId: 'emp-1',
        courseName: 'Advanced React',
      });

      const result = await service.decide('req-1', 'sa-1', { approve: true }, Role.SUPER_ADMIN);

      expect(result.status).toBe('APPROVED');
      expect(notifications.send).toHaveBeenCalledWith(
        expect.objectContaining({ recipientId: 'emp-1', template: 'learning.request-approved' }),
      );
    });

    it('rejects deciding an already-decided request', async () => {
      prisma.learningRequest.findUnique.mockResolvedValue({
        id: 'req-1',
        status: 'APPROVED',
      });

      await expect(
        service.decide('req-1', 'sa-1', { approve: true }, Role.SUPER_ADMIN),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('submitCertificate and markReimbursed', () => {
    it('rejects submitting a certificate for a request that is not yours', async () => {
      prisma.learningRequest.findUnique.mockResolvedValue({
        id: 'req-1',
        employeeId: 'emp-1',
        status: 'APPROVED',
      });

      await expect(
        service.submitCertificate('req-1', 'someone-else', 'https://cert.example.com'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rejects submitting a certificate before the request is approved', async () => {
      prisma.learningRequest.findUnique.mockResolvedValue({
        id: 'req-1',
        employeeId: 'emp-1',
        status: 'PENDING_SUPER_ADMIN',
      });

      await expect(
        service.submitCertificate('req-1', 'emp-1', 'https://cert.example.com'),
      ).rejects.toThrow(BadRequestException);
    });

    it('marks the request completed on certificate submission and notifies Super Admins', async () => {
      prisma.learningRequest.findUnique.mockResolvedValue({
        id: 'req-1',
        employeeId: 'emp-1',
        status: 'APPROVED',
        courseName: 'Advanced React',
      });
      prisma.employee.findMany.mockResolvedValue([{ id: 'sa-1' }]);
      prisma.learningRequest.update.mockResolvedValue({ id: 'req-1', status: 'COMPLETED' });

      const result = await service.submitCertificate('req-1', 'emp-1', 'https://cert.example.com');

      expect(result.status).toBe('COMPLETED');
      expect(notifications.send).toHaveBeenCalledWith(
        expect.objectContaining({ recipientId: 'sa-1', template: 'learning.certificate-submitted' }),
      );
    });

    it('rejects marking a request reimbursed before a certificate is submitted', async () => {
      prisma.learningRequest.findUnique.mockResolvedValue({
        id: 'req-1',
        status: 'APPROVED',
      });

      await expect(service.markReimbursed('req-1', 'sa-1')).rejects.toThrow(BadRequestException);
    });

    it('marks a completed request reimbursed and notifies the employee', async () => {
      prisma.learningRequest.findUnique.mockResolvedValue({
        id: 'req-1',
        employeeId: 'emp-1',
        status: 'COMPLETED',
        courseName: 'Advanced React',
      });
      prisma.learningRequest.update.mockResolvedValue({ id: 'req-1', status: 'REIMBURSED' });

      const result = await service.markReimbursed('req-1', 'sa-1');

      expect(result.status).toBe('REIMBURSED');
      expect(prisma.learningRequest.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'REIMBURSED', reimbursedBy: 'sa-1' }),
        }),
      );
      expect(notifications.send).toHaveBeenCalledWith(
        expect.objectContaining({ recipientId: 'emp-1', template: 'learning.reimbursed' }),
      );
    });
  });
});
