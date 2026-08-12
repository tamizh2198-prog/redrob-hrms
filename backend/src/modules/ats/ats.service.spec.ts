import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { AtsService } from './ats.service';
import { PrismaService } from '../../shared/database/prisma.service';
import { DefaultCompanyService } from '../../shared/database/default-company.service';
import { NotificationService } from '../../shared/notifications/notification.service';
import { MagicLinkService } from '../../shared/auth/magic-link.service';
import { EmployeeService } from '../employee/employee.service';
import { OnboardingService } from '../onboarding/onboarding.service';

function createMockPrisma() {
  return {
    jobRequisition: {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
    },
    candidate: {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
    interviewRound: {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      findFirst: jest.fn(),
    },
    offer: {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
    },
    $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
  };
}

function createMockNotifications() {
  return { send: jest.fn().mockResolvedValue(undefined) };
}

function createMockMagicLink() {
  return { sign: jest.fn(), verify: jest.fn() };
}

function createMockEmployeeService() {
  return { create: jest.fn() };
}

function createMockOnboardingService() {
  return {
    initChecklist: jest.fn().mockResolvedValue({ id: 'checklist-1' }),
    issuePreboardingLink: jest.fn().mockReturnValue('preboarding-token'),
  };
}

describe('AtsService', () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let notifications: ReturnType<typeof createMockNotifications>;
  let magicLink: ReturnType<typeof createMockMagicLink>;
  let employeeService: ReturnType<typeof createMockEmployeeService>;
  let onboardingService: ReturnType<typeof createMockOnboardingService>;
  let service: AtsService;

  beforeEach(() => {
    prisma = createMockPrisma();
    notifications = createMockNotifications();
    magicLink = createMockMagicLink();
    employeeService = createMockEmployeeService();
    onboardingService = createMockOnboardingService();
    service = new AtsService(
      prisma as unknown as PrismaService,
      { getOrCreate: jest.fn() } as unknown as DefaultCompanyService,
      notifications as unknown as NotificationService,
      magicLink as unknown as MagicLinkService,
      employeeService as unknown as EmployeeService,
      onboardingService as unknown as OnboardingService,
    );
  });

  describe('Acceptance Criteria: a requisition cannot be published without recorded approval', () => {
    it('rejects publishing a requisition still pending approval', async () => {
      prisma.jobRequisition.findUnique.mockResolvedValue({
        id: 'req-1',
        status: 'PENDING_APPROVAL',
      });

      await expect(service.publishRequisition('req-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('publishes once the requisition has been approved', async () => {
      prisma.jobRequisition.findUnique.mockResolvedValue({
        id: 'req-1',
        status: 'APPROVED',
      });
      prisma.jobRequisition.update.mockResolvedValue({
        id: 'req-1',
        status: 'PUBLISHED',
      });

      const result = await service.publishRequisition('req-1');
      expect(result.status).toBe('PUBLISHED');
    });
  });

  describe('Business Rule: duplicate candidates are flagged, not silently created', () => {
    it('still creates the candidate but records the duplicate link', async () => {
      prisma.jobRequisition.findUnique.mockResolvedValue({
        id: 'req-1',
        hiringManagerId: 'mgr-1',
      });
      prisma.candidate.findFirst.mockResolvedValue({
        id: 'existing-candidate',
      });
      prisma.candidate.create.mockImplementation(({ data }) =>
        Promise.resolve({ id: 'new-candidate', ...data }),
      );

      const result = await service.createCandidate({
        requisitionId: 'req-1',
        name: 'Jane Doe',
        email: 'jane@example.com',
      });

      expect(result.duplicateOfId).toBe('existing-candidate');
      expect(prisma.candidate.create).toHaveBeenCalled();
    });

    it('leaves duplicateOfId unset when no prior candidate matches', async () => {
      prisma.jobRequisition.findUnique.mockResolvedValue({
        id: 'req-1',
        hiringManagerId: 'mgr-1',
      });
      prisma.candidate.findFirst.mockResolvedValue(null);
      prisma.candidate.create.mockImplementation(({ data }) =>
        Promise.resolve({ id: 'new-candidate', ...data }),
      );

      const result = await service.createCandidate({
        requisitionId: 'req-1',
        name: 'John Smith',
        email: 'john@example.com',
      });

      expect(result.duplicateOfId).toBeUndefined();
    });
  });

  describe("Acceptance Criteria: a candidate cannot be moved to 'Offer' stage without a completed scorecard", () => {
    it('rejects the move when no interview round is completed', async () => {
      prisma.candidate.findUnique.mockResolvedValue({
        id: 'cand-1',
        requisition: { hiringManagerId: 'actor-1' },
      });
      prisma.interviewRound.findFirst.mockResolvedValue(null);

      await expect(
        service.moveStage('cand-1', 'OFFER', 'actor-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('allows the move once a scorecard is on file', async () => {
      prisma.candidate.findUnique.mockResolvedValue({
        id: 'cand-1',
        requisition: { hiringManagerId: 'actor-1' },
      });
      prisma.interviewRound.findFirst.mockResolvedValue({ id: 'round-1' });
      prisma.candidate.update.mockResolvedValue({
        id: 'cand-1',
        currentStage: 'OFFER',
      });

      const result = await service.moveStage('cand-1', 'OFFER', 'actor-1');
      expect(result.currentStage).toBe('OFFER');
    });

    it('rejects a manager who is not this requisition’s hiring manager', async () => {
      prisma.candidate.findUnique.mockResolvedValue({
        id: 'cand-1',
        requisition: { hiringManagerId: 'other-manager' },
      });

      await expect(
        service.moveStage('cand-1', 'OFFER', 'actor-1', Role.MANAGER),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('Business Rule: offer approval requires sign-off from Hiring Manager + HR Admin', () => {
    it('rejects a manager approval when the actor is not the requisition’s hiring manager', async () => {
      prisma.offer.findUnique.mockResolvedValue({
        id: 'offer-1',
        candidate: { requisition: { hiringManagerId: 'mgr-1' } },
      });

      await expect(
        service.approveOffer('offer-1', 'someone-else', 'MANAGER'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('records the hiring-manager sign-off when the actor matches', async () => {
      prisma.offer.findUnique.mockResolvedValue({
        id: 'offer-1',
        candidate: { requisition: { hiringManagerId: 'mgr-1' } },
      });
      prisma.offer.update.mockResolvedValue({
        id: 'offer-1',
        hiringManagerApprovedBy: 'mgr-1',
      });

      await service.approveOffer('offer-1', 'mgr-1', 'MANAGER');
      expect(prisma.offer.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ hiringManagerApprovedBy: 'mgr-1' }),
        }),
      );
    });

    it('rejects sending the offer until both approvals are recorded', async () => {
      prisma.offer.findUnique.mockResolvedValue({
        id: 'offer-1',
        hiringManagerApprovedAt: new Date(),
        hrApprovedAt: null,
        candidate: { id: 'cand-1', requisition: { hiringManagerId: 'mgr-1' } },
      });

      await expect(service.sendOffer('offer-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('sends the offer and returns a candidate response link once both approvals exist', async () => {
      prisma.offer.findUnique.mockResolvedValue({
        id: 'offer-1',
        hiringManagerApprovedAt: new Date(),
        hrApprovedAt: new Date(),
        candidate: { id: 'cand-1', requisition: { hiringManagerId: 'mgr-1' } },
      });
      prisma.offer.update.mockResolvedValue({ id: 'offer-1', status: 'SENT' });
      magicLink.sign.mockReturnValue('respond-token');

      const result = await service.sendOffer('offer-1');
      expect(result.responseLink).toBe('respond-token');
    });
  });

  describe('Acceptance Criteria: accepting an offer auto-creates a Preboarding record with zero re-entry', () => {
    it('creates an Employee in PREBOARDING status and initializes the onboarding checklist', async () => {
      prisma.offer.findUnique.mockResolvedValue({
        id: 'offer-1',
        candidateId: 'cand-1',
        status: 'SENT',
        candidate: {
          id: 'cand-1',
          name: 'Jane Doe',
          email: 'jane@example.com',
          phone: '555-0100',
          requisition: {
            companyId: 'co-1',
            departmentId: 'dept-1',
            hiringManagerId: 'mgr-1',
          },
        },
      });
      magicLink.verify.mockReturnValue({ sub: 'cand-1', offerId: 'offer-1' });
      employeeService.create.mockResolvedValue({ id: 'emp-1' });

      const result = await service.respondOffer('token-1', 'ACCEPT');

      expect(employeeService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'PREBOARDING',
          departmentId: 'dept-1',
        }),
        'system:ats',
      );
      expect(onboardingService.initChecklist).toHaveBeenCalledWith('emp-1');
      expect(result).toEqual(
        expect.objectContaining({
          status: 'ACCEPTED',
          employeeId: 'emp-1',
          preboardingLink: 'preboarding-token',
        }),
      );
    });

    it('does not fail offer acceptance when no onboarding template exists yet', async () => {
      prisma.offer.findUnique.mockResolvedValue({
        id: 'offer-1',
        candidateId: 'cand-1',
        status: 'SENT',
        candidate: {
          id: 'cand-1',
          name: 'Jane Doe',
          email: 'jane@example.com',
          requisition: {
            companyId: 'co-1',
            departmentId: 'dept-1',
            hiringManagerId: 'mgr-1',
          },
        },
      });
      magicLink.verify.mockReturnValue({ sub: 'cand-1', offerId: 'offer-1' });
      employeeService.create.mockResolvedValue({ id: 'emp-1' });
      onboardingService.initChecklist.mockRejectedValue(
        new Error('no template'),
      );

      const result = await service.respondOffer('token-1', 'ACCEPT');
      expect(result.status).toBe('ACCEPTED');
      expect(result.preboardingLink).toBeUndefined();
    });

    it('rejects a decision on an offer that is no longer sendable', async () => {
      prisma.offer.findUnique.mockResolvedValue({
        id: 'offer-1',
        candidateId: 'cand-1',
        status: 'ACCEPTED',
        candidate: { id: 'cand-1' },
      });
      magicLink.verify.mockReturnValue({ sub: 'cand-1', offerId: 'offer-1' });

      await expect(service.respondOffer('token-1', 'ACCEPT')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('declines the offer and marks the candidate rejected', async () => {
      prisma.offer.findUnique.mockResolvedValue({
        id: 'offer-1',
        candidateId: 'cand-1',
        status: 'SENT',
        candidate: { id: 'cand-1' },
      });
      magicLink.verify.mockReturnValue({ sub: 'cand-1', offerId: 'offer-1' });

      const result = await service.respondOffer('token-1', 'DECLINE');
      expect(result).toEqual({ status: 'DECLINED' });
      expect(employeeService.create).not.toHaveBeenCalled();
    });
  });
});
