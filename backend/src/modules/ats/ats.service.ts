import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  CandidateStage,
  OfferStatus,
  Prisma,
  RequisitionStatus,
  Role,
} from '@prisma/client';
import { PrismaService } from '../../shared/database/prisma.service';
import { DefaultCompanyService } from '../../shared/database/default-company.service';
import { NotificationService } from '../../shared/notifications/notification.service';
import {
  MagicLinkPayload,
  MagicLinkService,
} from '../../shared/auth/magic-link.service';
import { EmployeeService } from '../employee/employee.service';
import { OnboardingService } from '../onboarding/onboarding.service';
import { CreateRequisitionDto } from './dto/create-requisition.dto';
import { CreateCandidateDto } from './dto/create-candidate.dto';
import { ScheduleInterviewDto } from './dto/schedule-interview.dto';
import { SubmitScorecardDto } from './dto/submit-scorecard.dto';
import { CreateOfferDto } from './dto/create-offer.dto';

// Section 7.6 Business Rules: "Duplicate candidates (same email/phone
// within 12 months) are flagged, not silently created."
const DUPLICATE_LOOKBACK_MONTHS = 12;

const OFFER_RESPOND_PURPOSE = 'offer-respond';

function isPrivileged(role?: Role): boolean {
  return role === Role.HR_ADMIN || role === Role.SUPER_ADMIN;
}

@Injectable()
export class AtsService {
  private readonly logger = new Logger(AtsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly defaultCompany: DefaultCompanyService,
    private readonly notifications: NotificationService,
    private readonly magicLink: MagicLinkService,
    private readonly employeeService: EmployeeService,
    private readonly onboardingService: OnboardingService,
  ) {}

  async createRequisition(dto: CreateRequisitionDto, actorId: string) {
    const companyId =
      dto.companyId ?? (await this.defaultCompany.getOrCreate());
    const requisition = await this.prisma.jobRequisition.create({
      data: {
        companyId,
        title: dto.title,
        departmentId: dto.departmentId,
        hiringManagerId: dto.hiringManagerId,
        headcount: dto.headcount ?? 1,
        budgetCtc: dto.budgetCtc,
      },
    });

    await this.notifications.send({
      recipientId: 'hr-admin',
      template: 'ats.requisition-awaiting-approval',
      data: { requisitionId: requisition.id, raisedBy: actorId },
    });

    return requisition;
  }

  // Acceptance Criteria: "A requisition cannot be externally published
  // without recorded approval" — approve and publish are separate steps.
  async approveRequisition(id: string, actorId: string) {
    const requisition = await this.prisma.jobRequisition.findUnique({
      where: { id },
    });
    if (!requisition) throw new NotFoundException('Requisition not found');
    if (requisition.status !== RequisitionStatus.PENDING_APPROVAL) {
      throw new BadRequestException(
        'Only a pending requisition can be approved',
      );
    }

    return this.prisma.jobRequisition.update({
      where: { id },
      data: {
        status: RequisitionStatus.APPROVED,
        approvedBy: actorId,
        approvedAt: new Date(),
      },
    });
  }

  async publishRequisition(id: string) {
    const requisition = await this.prisma.jobRequisition.findUnique({
      where: { id },
    });
    if (!requisition) throw new NotFoundException('Requisition not found');
    if (requisition.status !== RequisitionStatus.APPROVED) {
      throw new BadRequestException(
        'A requisition cannot be published externally until approval is recorded',
      );
    }

    return this.prisma.jobRequisition.update({
      where: { id },
      data: { status: RequisitionStatus.PUBLISHED },
    });
  }

  // Section 6 matrix: Employee has no ATS access at all (enforced by the
  // controller's @Roles); a Manager only sees requisitions where they're
  // the hiring manager, not the whole company's pipeline.
  listRequisitions(actorId: string, actorRole?: Role) {
    return this.prisma.jobRequisition.findMany({
      where: isPrivileged(actorRole) ? undefined : { hiringManagerId: actorId },
      orderBy: { createdAt: 'desc' },
    });
  }

  private async findDuplicate(email: string, phone?: string) {
    const cutoff = new Date();
    cutoff.setUTCMonth(cutoff.getUTCMonth() - DUPLICATE_LOOKBACK_MONTHS);

    const or: Prisma.CandidateWhereInput[] = [{ email }];
    if (phone) or.push({ phone });

    return this.prisma.candidate.findFirst({
      where: { appliedAt: { gte: cutoff }, OR: or },
      orderBy: { appliedAt: 'desc' },
    });
  }

  // Public-facing (careers page apply form) and authenticated (manual
  // recruiter/referral entry) share this path — the endpoint is @Public()
  // so it never sees a CurrentUser either way.
  async createCandidate(dto: CreateCandidateDto) {
    const requisition = await this.prisma.jobRequisition.findUnique({
      where: { id: dto.requisitionId },
    });
    if (!requisition) throw new NotFoundException('Requisition not found');

    const duplicate = await this.findDuplicate(dto.email, dto.phone);

    const candidate = await this.prisma.candidate.create({
      data: {
        requisitionId: dto.requisitionId,
        name: dto.name,
        email: dto.email,
        phone: dto.phone,
        resumeRef: dto.resumeRef,
        source: dto.source,
        duplicateOfId: duplicate?.id,
      },
    });

    await this.notifications.send({
      recipientId: requisition.hiringManagerId,
      template: 'ats.application-received',
      data: { candidateId: candidate.id, requisitionId: requisition.id },
    });

    return candidate;
  }

  // Same scope as listRequisitions: a non-privileged Manager only sees
  // candidates for requisitions they're the hiring manager on.
  listCandidates(
    requisitionId: string | undefined,
    actorId: string,
    actorRole?: Role,
  ) {
    return this.prisma.candidate.findMany({
      where: {
        requisitionId,
        requisition: isPrivileged(actorRole)
          ? undefined
          : { hiringManagerId: actorId },
      },
      orderBy: { appliedAt: 'desc' },
    });
  }

  // Acceptance Criteria: "A candidate cannot be moved to 'Offer' stage
  // without at least one completed interview scorecard on file."
  async moveStage(
    candidateId: string,
    stage: CandidateStage,
    actorId: string,
    actorRole?: Role,
  ) {
    const candidate = await this.prisma.candidate.findUnique({
      where: { id: candidateId },
      include: { requisition: true },
    });
    if (!candidate) throw new NotFoundException('Candidate not found');

    if (
      !isPrivileged(actorRole) &&
      candidate.requisition.hiringManagerId !== actorId
    ) {
      throw new ForbiddenException(
        'Only this requisition’s hiring manager can move this candidate',
      );
    }

    if (stage === CandidateStage.OFFER) {
      const completedRound = await this.prisma.interviewRound.findFirst({
        where: { candidateId, completedAt: { not: null } },
      });
      if (!completedRound) {
        throw new BadRequestException(
          'This candidate needs at least one completed interview scorecard before moving to Offer',
        );
      }
    }

    const updated = await this.prisma.candidate.update({
      where: { id: candidateId },
      data: { currentStage: stage },
    });

    this.logger.log(`Candidate ${candidateId} moved to ${stage} by ${actorId}`);
    return updated;
  }

  async scheduleInterview(
    candidateId: string,
    dto: ScheduleInterviewDto,
    actorId: string,
    actorRole?: Role,
  ) {
    const candidate = await this.prisma.candidate.findUnique({
      where: { id: candidateId },
      include: { requisition: true },
    });
    if (!candidate) throw new NotFoundException('Candidate not found');

    if (
      !isPrivileged(actorRole) &&
      candidate.requisition.hiringManagerId !== actorId
    ) {
      throw new ForbiddenException(
        'Only this requisition’s hiring manager can schedule interviews for this candidate',
      );
    }

    const round = await this.prisma.interviewRound.create({
      data: {
        candidateId,
        interviewerId: dto.interviewerId,
        scheduledAt: new Date(dto.scheduledAt),
      },
    });

    await this.notifications.send({
      recipientId: dto.interviewerId,
      template: 'ats.interview-scheduled',
      data: { candidateId, roundId: round.id },
    });

    return round;
  }

  async submitScorecard(
    roundId: string,
    dto: SubmitScorecardDto,
    actorId: string,
    actorRole?: Role,
  ) {
    const round = await this.prisma.interviewRound.findUnique({
      where: { id: roundId },
    });
    if (!round) throw new NotFoundException('Interview round not found');
    if (round.interviewerId !== actorId && !isPrivileged(actorRole)) {
      throw new ForbiddenException(
        'Only the assigned interviewer can submit this scorecard',
      );
    }

    return this.prisma.interviewRound.update({
      where: { id: roundId },
      data: {
        scorecardJson: dto.scorecard as Prisma.InputJsonValue,
        recommendation: dto.recommendation,
        completedAt: new Date(),
      },
    });
  }

  async createOffer(dto: CreateOfferDto) {
    const candidate = await this.prisma.candidate.findUnique({
      where: { id: dto.candidateId },
    });
    if (!candidate) throw new NotFoundException('Candidate not found');
    if (candidate.currentStage !== CandidateStage.OFFER) {
      throw new BadRequestException(
        'This candidate has not reached the Offer stage yet',
      );
    }

    return this.prisma.offer.create({
      data: {
        candidateId: dto.candidateId,
        ctcBreakupJson: dto.ctcBreakup as Prisma.InputJsonValue,
      },
    });
  }

  // Business Rule: "Offer approval requires sign-off from Hiring Manager +
  // HR Admin before the letter is generated/sent" — two independent
  // approvals, tracked separately rather than as a sequenced chain.
  async approveOffer(offerId: string, actorId: string, actorRole?: Role) {
    const offer = await this.prisma.offer.findUnique({
      where: { id: offerId },
      include: { candidate: { include: { requisition: true } } },
    });
    if (!offer) throw new NotFoundException('Offer not found');

    if (actorRole === Role.MANAGER) {
      if (offer.candidate.requisition.hiringManagerId !== actorId) {
        throw new ForbiddenException(
          'Only this requisition’s hiring manager can give the hiring-manager sign-off',
        );
      }
      return this.prisma.offer.update({
        where: { id: offerId },
        data: {
          hiringManagerApprovedBy: actorId,
          hiringManagerApprovedAt: new Date(),
        },
      });
    }

    if (isPrivileged(actorRole)) {
      return this.prisma.offer.update({
        where: { id: offerId },
        data: { hrApprovedBy: actorId, hrApprovedAt: new Date() },
      });
    }

    throw new ForbiddenException('Not authorized to approve this offer');
  }

  async sendOffer(offerId: string) {
    const offer = await this.prisma.offer.findUnique({
      where: { id: offerId },
      include: { candidate: { include: { requisition: true } } },
    });
    if (!offer) throw new NotFoundException('Offer not found');
    if (!offer.hiringManagerApprovedAt || !offer.hrApprovedAt) {
      throw new BadRequestException(
        'Offer approval requires sign-off from both the Hiring Manager and HR Admin before it can be sent',
      );
    }

    const responseLink = this.magicLink.sign(
      {
        sub: offer.candidate.id,
        purpose: OFFER_RESPOND_PURPOSE,
        offerId: offer.id,
      },
      '14d',
    );

    const updated = await this.prisma.offer.update({
      where: { id: offerId },
      data: {
        status: OfferStatus.SENT,
        sentAt: new Date(),
        docRef: `offer-letter-${offerId}.pdf`,
      },
    });

    await this.notifications.send({
      recipientId: offer.candidate.requisition.hiringManagerId,
      template: 'ats.offer-sent',
      data: { offerId },
    });

    // No employee-style recipient exists for an external candidate yet
    // (see MagicLinkService) — the response link is returned directly so
    // the caller (HR/recruiter UI) can relay it, rather than silently
    // dropped.
    return { offer: updated, responseLink };
  }

  // Lets the candidate-facing offer-response page show what it's asking
  // them to accept/decline, without any employee login — gated purely by
  // possessing the magic-link token.
  async getOfferByToken(token: string) {
    const decoded = this.magicLink.verify<
      MagicLinkPayload & { offerId: string }
    >(token, OFFER_RESPOND_PURPOSE);

    const offer = await this.prisma.offer.findUnique({
      where: { id: decoded.offerId },
      include: { candidate: { include: { requisition: true } } },
    });
    if (!offer || offer.candidateId !== decoded.sub) {
      throw new NotFoundException('Offer not found');
    }

    return {
      status: offer.status,
      ctcBreakup: offer.ctcBreakupJson,
      candidateName: offer.candidate.name,
      requisitionTitle: offer.candidate.requisition.title,
    };
  }

  async respondOffer(token: string, decision: 'ACCEPT' | 'DECLINE') {
    const decoded = this.magicLink.verify<
      MagicLinkPayload & { offerId: string }
    >(token, OFFER_RESPOND_PURPOSE);

    const offer = await this.prisma.offer.findUnique({
      where: { id: decoded.offerId },
      include: { candidate: { include: { requisition: true } } },
    });
    if (!offer || offer.candidateId !== decoded.sub) {
      throw new NotFoundException('Offer not found');
    }
    if (offer.status !== OfferStatus.SENT) {
      throw new BadRequestException(
        'This offer has already been responded to or is not sendable',
      );
    }

    if (decision === 'DECLINE') {
      await this.prisma.$transaction([
        this.prisma.offer.update({
          where: { id: offer.id },
          data: { status: OfferStatus.DECLINED },
        }),
        this.prisma.candidate.update({
          where: { id: offer.candidateId },
          data: { currentStage: CandidateStage.REJECTED },
        }),
      ]);
      return { status: 'DECLINED' };
    }

    const [firstName, ...rest] = offer.candidate.name.trim().split(/\s+/);
    const lastName = rest.length > 0 ? rest.join(' ') : firstName;

    // Zero re-entry (Acceptance Criteria): the candidate's own data seeds
    // the new Employee row directly via the same EmployeeService.create()
    // path Section 7.1 uses, rather than duplicating creation logic here.
    const employee = await this.employeeService.create(
      {
        companyId: offer.candidate.requisition.companyId,
        firstName,
        lastName,
        personalEmail: offer.candidate.email,
        phone: offer.candidate.phone ?? undefined,
        departmentId: offer.candidate.requisition.departmentId,
        reportingManagerId: offer.candidate.requisition.hiringManagerId,
        status: 'PREBOARDING',
      },
      'system:ats',
    );

    await this.prisma.$transaction([
      this.prisma.offer.update({
        where: { id: offer.id },
        data: {
          status: OfferStatus.ACCEPTED,
          acceptedAt: new Date(),
          createdEmployeeId: employee.id,
        },
      }),
      this.prisma.candidate.update({
        where: { id: offer.candidateId },
        data: { currentStage: CandidateStage.HIRED },
      }),
    ]);

    let preboardingLink: string | undefined;
    try {
      await this.onboardingService.initChecklist(employee.id);
      preboardingLink = this.onboardingService.issuePreboardingLink(
        employee.id,
      );
    } catch (err) {
      // A missing template shouldn't roll back a real, already-created
      // Employee record — HR can run POST /onboarding/:employeeId/init
      // manually once a template exists.
      this.logger.warn(
        `Could not auto-create onboarding checklist for employee ${employee.id}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    await this.notifications.send({
      recipientId: offer.candidate.requisition.hiringManagerId,
      template: 'ats.offer-accepted',
      data: { candidateId: offer.candidateId, employeeId: employee.id },
    });

    return { status: 'ACCEPTED', employeeId: employee.id, preboardingLink };
  }

  async getPipelineAnalytics(requisitionId: string) {
    const candidates = await this.prisma.candidate.findMany({
      where: { requisitionId },
    });
    const byStage = Object.values(CandidateStage).reduce<
      Record<string, number>
    >((acc, stage) => {
      acc[stage] = candidates.filter((c) => c.currentStage === stage).length;
      return acc;
    }, {});

    const requisition = await this.prisma.jobRequisition.findUnique({
      where: { id: requisitionId },
    });
    const acceptedOffers = await this.prisma.offer.findMany({
      where: {
        candidate: { requisitionId },
        status: OfferStatus.ACCEPTED,
        acceptedAt: { not: null },
      },
    });

    let timeToFillDays: number | null = null;
    if (requisition?.approvedAt && acceptedOffers.length > 0) {
      const msPerDay = 24 * 60 * 60 * 1000;
      const totalDays = acceptedOffers.reduce(
        (sum, o) =>
          sum +
          (o.acceptedAt!.getTime() - requisition.approvedAt!.getTime()) /
            msPerDay,
        0,
      );
      timeToFillDays = Math.round(totalDays / acceptedOffers.length);
    }

    return { totalCandidates: candidates.length, byStage, timeToFillDays };
  }
}
