import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { AtsService } from './ats.service';
import { PrismaService } from '../../shared/database/prisma.service';
import { DefaultCompanyService } from '../../shared/database/default-company.service';
import { NotificationService } from '../../shared/notifications/notification.service';
import { MagicLinkService } from '../../shared/auth/magic-link.service';
import { EmployeeService } from '../employee/employee.service';
import { OnboardingService } from '../onboarding/onboarding.service';
import { EmailService } from '../../shared/email/email.service';

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
    offerTemplate: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      delete: jest.fn(),
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

function createMockEmail() {
  return { send: jest.fn().mockResolvedValue({ sent: true }) };
}

describe('AtsService', () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let notifications: ReturnType<typeof createMockNotifications>;
  let magicLink: ReturnType<typeof createMockMagicLink>;
  let employeeService: ReturnType<typeof createMockEmployeeService>;
  let onboardingService: ReturnType<typeof createMockOnboardingService>;
  let email: ReturnType<typeof createMockEmail>;
  let defaultCompany: { getOrCreate: jest.Mock };
  let service: AtsService;

  beforeEach(() => {
    prisma = createMockPrisma();
    notifications = createMockNotifications();
    magicLink = createMockMagicLink();
    employeeService = createMockEmployeeService();
    onboardingService = createMockOnboardingService();
    email = createMockEmail();
    defaultCompany = { getOrCreate: jest.fn().mockResolvedValue('company-1') };
    service = new AtsService(
      prisma as unknown as PrismaService,
      defaultCompany as unknown as DefaultCompanyService,
      notifications as unknown as NotificationService,
      magicLink as unknown as MagicLinkService,
      employeeService as unknown as EmployeeService,
      onboardingService as unknown as OnboardingService,
      email as unknown as EmailService,
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

    it('lets HR Associate move any candidate, like HR Admin, even when not the hiring manager', async () => {
      prisma.candidate.findUnique.mockResolvedValue({
        id: 'cand-1',
        requisition: { hiringManagerId: 'other-manager' },
      });
      prisma.interviewRound.findFirst.mockResolvedValue({ id: 'round-1' });
      prisma.candidate.update.mockResolvedValue({
        id: 'cand-1',
        currentStage: 'OFFER',
      });

      const result = await service.moveStage(
        'cand-1',
        'OFFER',
        'ha-1',
        Role.HR_ASSOCIATE,
      );
      expect(result.currentStage).toBe('OFFER');
    });
  });

  describe('Business Rule: offer approval is HR Admin/Super Admin only', () => {
    it('rejects an approval attempt from a Manager, even the requisition’s own hiring manager', async () => {
      await expect(
        service.approveOffer('offer-1', 'mgr-1', 'MANAGER'),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.offer.findUnique).not.toHaveBeenCalled();
    });

    it('rejects an approval attempt from an Employee', async () => {
      await expect(
        service.approveOffer('offer-1', 'someone-else', 'EMPLOYEE'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rejects an approval attempt from HR Associate — mirrors HR_ADMIN elsewhere but has no decision authority', async () => {
      await expect(
        service.approveOffer('offer-1', 'ha-1', 'HR_ASSOCIATE'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('records the HR sign-off for HR Admin', async () => {
      prisma.offer.findUnique.mockResolvedValue({ id: 'offer-1' });
      prisma.offer.update.mockResolvedValue({
        id: 'offer-1',
        hrApprovedBy: 'hr-1',
      });

      await service.approveOffer('offer-1', 'hr-1', 'HR_ADMIN');
      expect(prisma.offer.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ hrApprovedBy: 'hr-1' }),
        }),
      );
    });

    it('rejects sending the offer until HR approval is recorded', async () => {
      prisma.offer.findUnique.mockResolvedValue({
        id: 'offer-1',
        hrApprovedAt: null,
        candidate: { id: 'cand-1', requisition: { hiringManagerId: 'mgr-1' } },
      });

      await expect(service.sendOffer('offer-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('sends the offer, emails the candidate a response link, and returns it once HR approval exists', async () => {
      prisma.offer.findUnique.mockResolvedValue({
        id: 'offer-1',
        hrApprovedAt: new Date(),
        candidate: {
          id: 'cand-1',
          name: 'Jane Doe',
          email: 'jane@example.com',
          requisition: { title: 'Software Engineer', hiringManagerId: 'mgr-1' },
        },
      });
      prisma.offer.update.mockResolvedValue({ id: 'offer-1', status: 'SENT' });
      magicLink.sign.mockReturnValue('respond-token');

      const result = await service.sendOffer('offer-1');
      expect(result.responseLink).toBe('respond-token');
      expect(email.send).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'jane@example.com',
          text: expect.stringContaining('respond-token'),
        }),
      );
    });
  });

  describe('Offer letter templates', () => {
    it('renders the built-in default copy (subject + CTC + response link) when no template is picked or configured', async () => {
      prisma.offer.findUnique.mockResolvedValue({
        id: 'offer-1',
        hrApprovedAt: new Date(),
        ctcBreakupJson: { ctcLpa: 18 },
        candidate: {
          id: 'cand-1',
          name: 'Jane Doe',
          email: 'jane@example.com',
          requisition: {
            title: 'Software Engineer',
            companyId: 'company-1',
            hiringManagerId: 'mgr-1',
          },
        },
      });
      prisma.offer.update.mockResolvedValue({ id: 'offer-1', status: 'SENT' });
      magicLink.sign.mockReturnValue('respond-token');

      await service.sendOffer('offer-1');

      expect(email.send).toHaveBeenCalledWith({
        to: 'jane@example.com',
        subject: 'Your offer for Software Engineer',
        text: expect.stringContaining('₹18 LPA'),
      });
      expect(prisma.offer.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ templateId: null }) }),
      );
    });

    it('renders whichever template the sender picks at send time, over the company default', async () => {
      prisma.offer.findUnique.mockResolvedValue({
        id: 'offer-1',
        hrApprovedAt: new Date(),
        ctcBreakupJson: { ctcLpa: 25 },
        candidate: {
          id: 'cand-1',
          name: 'Jane Doe',
          email: 'jane@example.com',
          requisition: {
            title: 'Staff Engineer',
            companyId: 'company-1',
            hiringManagerId: 'mgr-1',
          },
        },
      });
      prisma.offerTemplate.findUnique.mockResolvedValue({
        id: 'tpl-picked',
        subject: 'Offer: {{requisitionTitle}} at Redrob',
        body: 'Dear {{candidateName}}, your CTC is {{ctc}}. Respond: {{responseLink}}',
      });
      prisma.offer.update.mockResolvedValue({ id: 'offer-1', status: 'SENT' });
      magicLink.sign.mockReturnValue('respond-token');

      await service.sendOffer('offer-1', 'tpl-picked');

      expect(prisma.offerTemplate.findUnique).toHaveBeenCalledWith({
        where: { id: 'tpl-picked' },
      });
      expect(prisma.offerTemplate.findFirst).not.toHaveBeenCalled();
      expect(email.send).toHaveBeenCalledWith(
        expect.objectContaining({
          subject: 'Offer: Staff Engineer at Redrob',
          text: expect.stringContaining('Dear Jane Doe, your CTC is ₹25 LPA. Respond:'),
        }),
      );
      expect(prisma.offer.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ templateId: 'tpl-picked' }),
        }),
      );
    });

    it('rejects sending with a templateId that does not exist', async () => {
      prisma.offer.findUnique.mockResolvedValue({
        id: 'offer-1',
        hrApprovedAt: new Date(),
        ctcBreakupJson: { ctcLpa: 10 },
        candidate: {
          id: 'cand-1',
          name: 'Jane Doe',
          email: 'jane@example.com',
          requisition: {
            title: 'QA Engineer',
            companyId: 'company-1',
            hiringManagerId: 'mgr-1',
          },
        },
      });
      prisma.offerTemplate.findUnique.mockResolvedValue(null);

      await expect(service.sendOffer('offer-1', 'ghost')).rejects.toThrow(
        'Offer template not found',
      );
    });

    it("falls back to the company's default template when the sender leaves it unset", async () => {
      prisma.offer.findUnique.mockResolvedValue({
        id: 'offer-1',
        hrApprovedAt: new Date(),
        ctcBreakupJson: { ctcLpa: 10 },
        candidate: {
          id: 'cand-1',
          name: 'Jane Doe',
          email: 'jane@example.com',
          requisition: {
            title: 'QA Engineer',
            companyId: 'company-1',
            hiringManagerId: 'mgr-1',
          },
        },
      });
      prisma.offerTemplate.findFirst.mockResolvedValue({
        id: 'tpl-default',
        subject: 'Welcome, {{candidateName}}!',
        body: 'Role: {{requisitionTitle}}',
      });
      prisma.offer.update.mockResolvedValue({ id: 'offer-1', status: 'SENT' });
      magicLink.sign.mockReturnValue('respond-token');

      await service.sendOffer('offer-1');

      expect(prisma.offerTemplate.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { companyId: 'company-1', isDefault: true },
        }),
      );
      expect(email.send).toHaveBeenCalledWith(
        expect.objectContaining({
          subject: 'Welcome, Jane Doe!',
          text: 'Role: QA Engineer',
        }),
      );
      expect(prisma.offer.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ templateId: 'tpl-default' }),
        }),
      );
    });

    it('clears any other default when creating a new default template', async () => {
      prisma.offerTemplate.create.mockResolvedValue({ id: 'tpl-2', isDefault: true });

      await service.createOfferTemplate({
        name: 'Standard Offer',
        subject: 'Subj',
        body: 'Body',
        isDefault: true,
      });

      expect(prisma.offerTemplate.updateMany).toHaveBeenCalledWith({
        where: { companyId: 'company-1', isDefault: true },
        data: { isDefault: false },
      });
      expect(prisma.offerTemplate.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ companyId: 'company-1', isDefault: true }),
        }),
      );
    });

    it('rejects updating/deleting a template that does not exist', async () => {
      prisma.offerTemplate.findUnique.mockResolvedValue(null);

      await expect(
        service.updateOfferTemplate('ghost', { name: 'x' }),
      ).rejects.toThrow('Offer template not found');
      await expect(service.deleteOfferTemplate('ghost')).rejects.toThrow(
        'Offer template not found',
      );
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
      expect(email.send).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'jane@example.com',
          text: expect.stringContaining('preboarding-token'),
        }),
      );
      expect(result).toEqual(
        expect.objectContaining({
          status: 'ACCEPTED',
          employeeId: 'emp-1',
          preboardingLink: 'preboarding-token',
        }),
      );
    });

    it('does not fail offer acceptance when no onboarding template exists yet, and flags HR instead', async () => {
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
      expect(email.send).not.toHaveBeenCalled();
      expect(notifications.send).toHaveBeenCalledWith(
        expect.objectContaining({
          recipientId: 'mgr-1',
          template: 'ats.preboarding-init-failed',
          data: { employeeId: 'emp-1' },
        }),
      );
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
