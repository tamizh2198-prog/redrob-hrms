import type { PrismaClient, Prisma, Role, CandidateStage } from "@prisma/client";
import { getOrCreateDefaultCompanyId } from "../../lib/default-company";
import { notify } from "../../lib/notify";
import { sendEmail } from "../../lib/email";
import { getFrontendUrl } from "../../lib/frontend-url";
import { signMagicLink, verifyMagicLink, type MagicLinkPayload } from "../../lib/auth";
import { BadRequestError, ForbiddenError, NotFoundError } from "../../lib/errors";
import { enforceRateLimit, recordRateLimitAttempt } from "../../lib/rate-limit";
import * as employeeService from "../employee/service";
import * as onboardingService from "../onboarding/service";
import type {
  CreateCandidateDto,
  CreateOfferDto,
  CreateOfferTemplateDto,
  CreateRequisitionDto,
  ScheduleInterviewDto,
  SubmitScorecardDto,
  UpdateOfferTemplateDto,
} from "./dto";

// Business Rules: "Duplicate candidates (same email/phone within 12
// months) are flagged, not silently created."
const DUPLICATE_LOOKBACK_MONTHS = 12;

const OFFER_RESPOND_PURPOSE = "offer-respond";

// Decision authority (approveOffer) — HR_ASSOCIATE deliberately excluded,
// unlike isHrStaff below.
function isPrivileged(role?: Role): boolean {
  return role === "HR_ADMIN" || role === "SUPER_ADMIN";
}

// General visibility/on-behalf-of overrides (listRequisitions,
// listCandidates, moveStage, scheduleInterview, submitScorecard) — mirrors
// HR_ADMIN's access without granting offer-approval authority.
function isHrStaff(role?: Role): boolean {
  return isPrivileged(role) || role === "HR_ASSOCIATE";
}

// Built-in copy used whenever no OfferTemplate is selected/configured —
// keeps offer sending working with zero setup, same wording this service
// always sent before templates existed.
const DEFAULT_OFFER_TEMPLATE = {
  subject: "Your offer for {{requisitionTitle}}",
  body: [
    "Hi {{candidateName}},",
    "",
    "Congratulations! You have an offer for {{requisitionTitle}} with a CTC of {{ctc}}.",
    "Review and respond to your offer here: {{responseLink}}",
    "This link expires in 14 days.",
  ].join("\n"),
};

const TEMPLATE_PLACEHOLDER = /\{\{\s*(\w+)\s*\}\}/g;

function renderOfferTemplate(text: string, vars: Record<string, string>): string {
  return text.replace(TEMPLATE_PLACEHOLDER, (_match, key: string) => vars[key] ?? "");
}

function formatCtc(ctcBreakupJson: unknown): string {
  if (ctcBreakupJson && typeof ctcBreakupJson === "object" && "ctcLpa" in ctcBreakupJson) {
    return `₹${(ctcBreakupJson as { ctcLpa: unknown }).ctcLpa} LPA`;
  }
  if (ctcBreakupJson && typeof ctcBreakupJson === "object") {
    return Object.entries(ctcBreakupJson as Record<string, unknown>)
      .map(([key, value]) => `${key}: ${value}`)
      .join(", ");
  }
  return "";
}

export async function createRequisition(prisma: PrismaClient, dto: CreateRequisitionDto, actorId: string) {
  const companyId = dto.companyId ?? (await getOrCreateDefaultCompanyId(prisma));
  const requisition = await prisma.jobRequisition.create({
    data: {
      companyId,
      title: dto.title,
      departmentId: dto.departmentId,
      hiringManagerId: dto.hiringManagerId,
      headcount: dto.headcount ?? 1,
      budgetCtc: dto.budgetCtc,
    },
  });

  await notify(prisma, {
    recipientId: "hr-admin",
    template: "ats.requisition-awaiting-approval",
    body: `A new job requisition "${requisition.title}" is awaiting your approval.`,
    data: { requisitionId: requisition.id, raisedBy: actorId },
  });

  return requisition;
}

// Acceptance Criteria: "A requisition cannot be externally published
// without recorded approval" — approve and publish are separate steps.
export async function approveRequisition(prisma: PrismaClient, id: string, actorId: string) {
  const requisition = await prisma.jobRequisition.findUnique({ where: { id } });
  if (!requisition) throw new NotFoundError("Requisition not found");
  if (requisition.status !== "PENDING_APPROVAL") {
    throw new BadRequestError("Only a pending requisition can be approved");
  }

  return prisma.jobRequisition.update({
    where: { id },
    data: { status: "APPROVED", approvedBy: actorId, approvedAt: new Date() },
  });
}

export async function publishRequisition(prisma: PrismaClient, id: string) {
  const requisition = await prisma.jobRequisition.findUnique({ where: { id } });
  if (!requisition) throw new NotFoundError("Requisition not found");
  if (requisition.status !== "APPROVED") {
    throw new BadRequestError("A requisition cannot be published externally until approval is recorded");
  }

  return prisma.jobRequisition.update({ where: { id }, data: { status: "PUBLISHED" } });
}

// Employee has no ATS access at all (enforced by role gating at the route);
// a Manager only sees requisitions where they're the hiring manager, not
// the whole company's pipeline.
export function listRequisitions(prisma: PrismaClient, actorId: string, actorRole?: Role) {
  return prisma.jobRequisition.findMany({
    where: isHrStaff(actorRole) ? undefined : { hiringManagerId: actorId },
    orderBy: { createdAt: "desc" },
  });
}

async function findDuplicate(prisma: PrismaClient, email: string, phone?: string) {
  const cutoff = new Date();
  cutoff.setUTCMonth(cutoff.getUTCMonth() - DUPLICATE_LOOKBACK_MONTHS);

  const or: Prisma.CandidateWhereInput[] = [{ email }];
  if (phone) or.push({ phone });

  return prisma.candidate.findFirst({
    where: { appliedAt: { gte: cutoff }, OR: or },
    orderBy: { appliedAt: "desc" },
  });
}

const CANDIDATE_CREATE_RATE_LIMIT = { max: 10, windowMs: 60 * 60 * 1000 };

// Public-facing (careers page apply form) and authenticated (manual
// recruiter/referral entry) share this path — the route is public so it
// never sees an actor either way. `clientIp` is best-effort (from
// x-forwarded-for) — rate-limited on it regardless, since even an
// unreliable key is better than none for a fully unauthenticated endpoint.
export async function createCandidate(prisma: PrismaClient, dto: CreateCandidateDto, clientIp: string) {
  await enforceRateLimit(prisma, `candidate-create:${clientIp}`, CANDIDATE_CREATE_RATE_LIMIT);
  await recordRateLimitAttempt(prisma, `candidate-create:${clientIp}`);

  const requisition = await prisma.jobRequisition.findUnique({ where: { id: dto.requisitionId } });
  if (!requisition) throw new NotFoundError("Requisition not found");
  if (requisition.status !== "PUBLISHED") {
    throw new BadRequestError("This requisition is not currently accepting applications");
  }

  const duplicate = await findDuplicate(prisma, dto.email, dto.phone);

  const candidate = await prisma.candidate.create({
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

  await notify(prisma, {
    recipientId: requisition.hiringManagerId,
    template: "ats.application-received",
    body: `${candidate.name} applied for "${requisition.title}".`,
    data: { candidateId: candidate.id, requisitionId: requisition.id },
  });

  return candidate;
}

// Same scope as listRequisitions: a non-privileged Manager only sees
// candidates for requisitions they're the hiring manager on.
export function listCandidates(prisma: PrismaClient, requisitionId: string | undefined, actorId: string, actorRole?: Role) {
  return prisma.candidate.findMany({
    where: {
      requisitionId,
      requisition: isHrStaff(actorRole) ? undefined : { hiringManagerId: actorId },
    },
    // So Manager/HR Admin/Super Admin can see the full offer flow (status,
    // both sign-offs, sent/accepted dates, and the employee it created)
    // straight from the pipeline view instead of it dead-ending once an
    // offer exists.
    include: { offers: { orderBy: { createdAt: "desc" } } },
    orderBy: { appliedAt: "desc" },
  });
}

// Acceptance Criteria: "A candidate cannot be moved to 'Offer' stage
// without at least one completed interview scorecard on file."
export async function moveStage(prisma: PrismaClient, candidateId: string, stage: CandidateStage, actorId: string, actorRole?: Role) {
  const candidate = await prisma.candidate.findUnique({
    where: { id: candidateId },
    include: { requisition: true },
  });
  if (!candidate) throw new NotFoundError("Candidate not found");

  if (!isHrStaff(actorRole) && candidate.requisition.hiringManagerId !== actorId) {
    throw new ForbiddenError("Only this requisition's hiring manager can move this candidate");
  }

  if (stage === "OFFER") {
    const completedRound = await prisma.interviewRound.findFirst({
      where: { candidateId, completedAt: { not: null } },
    });
    if (!completedRound) {
      throw new BadRequestError("This candidate needs at least one completed interview scorecard before moving to Offer");
    }
  }

  const updated = await prisma.candidate.update({ where: { id: candidateId }, data: { currentStage: stage } });

  console.log(`Candidate ${candidateId} moved to ${stage} by ${actorId}`);
  return updated;
}

export async function scheduleInterview(prisma: PrismaClient, candidateId: string, dto: ScheduleInterviewDto, actorId: string, actorRole?: Role) {
  const candidate = await prisma.candidate.findUnique({
    where: { id: candidateId },
    include: { requisition: true },
  });
  if (!candidate) throw new NotFoundError("Candidate not found");

  if (!isHrStaff(actorRole) && candidate.requisition.hiringManagerId !== actorId) {
    throw new ForbiddenError("Only this requisition's hiring manager can schedule interviews for this candidate");
  }

  const round = await prisma.interviewRound.create({
    data: { candidateId, interviewerId: dto.interviewerId, scheduledAt: new Date(dto.scheduledAt) },
  });

  await notify(prisma, {
    recipientId: dto.interviewerId,
    template: "ats.interview-scheduled",
    body: `You've been scheduled to interview ${candidate.name} on ${new Date(dto.scheduledAt).toISOString().slice(0, 10)}.`,
    data: { candidateId, roundId: round.id },
  });

  return round;
}

export async function submitScorecard(prisma: PrismaClient, roundId: string, dto: SubmitScorecardDto, actorId: string, actorRole?: Role) {
  const round = await prisma.interviewRound.findUnique({ where: { id: roundId } });
  if (!round) throw new NotFoundError("Interview round not found");
  if (round.interviewerId !== actorId && !isHrStaff(actorRole)) {
    throw new ForbiddenError("Only the assigned interviewer can submit this scorecard");
  }

  return prisma.interviewRound.update({
    where: { id: roundId },
    data: {
      scorecardJson: dto.scorecard as Prisma.InputJsonValue,
      recommendation: dto.recommendation,
      completedAt: new Date(),
    },
  });
}

export async function createOffer(prisma: PrismaClient, dto: CreateOfferDto) {
  const candidate = await prisma.candidate.findUnique({ where: { id: dto.candidateId } });
  if (!candidate) throw new NotFoundError("Candidate not found");
  if (candidate.currentStage !== "OFFER") {
    throw new BadRequestError("This candidate has not reached the Offer stage yet");
  }
  return prisma.offer.create({
    data: { candidateId: dto.candidateId, ctcBreakupJson: dto.ctcBreakup as Prisma.InputJsonValue },
  });
}

// Business Rule: offer approval is HR Admin/Super Admin only — the hiring
// manager has no sign-off role in this step (hiringManagerApprovedBy/At on
// the Offer model are legacy columns, never written going forward).
export async function approveOffer(prisma: PrismaClient, offerId: string, actorId: string, actorRole?: Role) {
  if (!isPrivileged(actorRole)) {
    throw new ForbiddenError("Only HR Admin or Super Admin can approve an offer");
  }
  const offer = await prisma.offer.findUnique({ where: { id: offerId } });
  if (!offer) throw new NotFoundError("Offer not found");

  return prisma.offer.update({ where: { id: offerId }, data: { hrApprovedBy: actorId, hrApprovedAt: new Date() } });
}

export async function sendOffer(prisma: PrismaClient, offerId: string, templateId?: string) {
  const offer = await prisma.offer.findUnique({
    where: { id: offerId },
    include: { candidate: { include: { requisition: true } } },
  });
  if (!offer) throw new NotFoundError("Offer not found");
  if (!offer.hrApprovedAt) {
    throw new BadRequestError("Offer approval by HR Admin or Super Admin is required before it can be sent");
  }

  // The sender picks the letter template here, at send time — not when the
  // offer was created — so the choice reflects whatever templates exist
  // right now rather than whatever was around at creation.
  let selectedTemplate: { id: string; subject: string; body: string } | null = null;
  if (templateId) {
    selectedTemplate = await prisma.offerTemplate.findUnique({ where: { id: templateId } });
    if (!selectedTemplate) throw new NotFoundError("Offer template not found");
  }

  const companyDefaultTemplate =
    selectedTemplate ??
    (await prisma.offerTemplate.findFirst({
      where: { companyId: offer.candidate.requisition.companyId, isDefault: true },
    }));
  const letterTemplate = companyDefaultTemplate ?? DEFAULT_OFFER_TEMPLATE;

  const responseLink = signMagicLink({ sub: offer.candidate.id, purpose: OFFER_RESPOND_PURPOSE, offerId: offer.id }, "14d");

  const updated = await prisma.offer.update({
    where: { id: offerId },
    data: {
      status: "SENT",
      sentAt: new Date(),
      docRef: `offer-letter-${offerId}.pdf`,
      // null when the built-in fallback copy was used (matches the
      // OfferTemplate? field's meaning — see schema.prisma).
      templateId: companyDefaultTemplate?.id ?? null,
    },
  });

  await notify(prisma, {
    recipientId: offer.candidate.requisition.hiringManagerId,
    template: "ats.offer-sent",
    body: `The offer for "${offer.candidate.requisition.title}" was sent to ${offer.candidate.name}.`,
    data: { offerId },
  });

  // The candidate has no employee/notification account yet, so the
  // response link is delivered by real email (not the notify() helper,
  // which only reaches existing Employee rows) — still also returned to
  // the caller below so HR can relay it manually if delivery fails.
  const baseUrl = getFrontendUrl();
  const responseUrl = `${baseUrl}/offers/respond?token=${responseLink}`;

  const templateVars = {
    candidateName: offer.candidate.name,
    requisitionTitle: offer.candidate.requisition.title,
    ctc: formatCtc(offer.ctcBreakupJson),
    responseLink: responseUrl,
  };

  await sendEmail({
    to: offer.candidate.email,
    subject: renderOfferTemplate(letterTemplate.subject, templateVars),
    text: renderOfferTemplate(letterTemplate.body, templateVars),
  });

  return { offer: updated, responseLink };
}

// Customizable offer letter templates (HR Admin/Super Admin). At most one
// default per company — enforced here via sequential awaits rather than a
// DB constraint, since "isDefault: true" needs to clear every other row's
// flag first.
export async function createOfferTemplate(prisma: PrismaClient, dto: CreateOfferTemplateDto) {
  const companyId = await getOrCreateDefaultCompanyId(prisma);
  if (dto.isDefault) {
    await prisma.offerTemplate.updateMany({ where: { companyId, isDefault: true }, data: { isDefault: false } });
  }
  return prisma.offerTemplate.create({
    data: { companyId, name: dto.name, subject: dto.subject, body: dto.body, isDefault: dto.isDefault ?? false },
  });
}

export function listOfferTemplates(prisma: PrismaClient) {
  return prisma.offerTemplate.findMany({ orderBy: { createdAt: "desc" } });
}

export async function updateOfferTemplate(prisma: PrismaClient, id: string, dto: UpdateOfferTemplateDto) {
  const template = await prisma.offerTemplate.findUnique({ where: { id } });
  if (!template) throw new NotFoundError("Offer template not found");

  if (dto.isDefault) {
    await prisma.offerTemplate.updateMany({ where: { companyId: template.companyId, isDefault: true }, data: { isDefault: false } });
  }
  return prisma.offerTemplate.update({
    where: { id },
    data: { name: dto.name, subject: dto.subject, body: dto.body, isDefault: dto.isDefault },
  });
}

export async function deleteOfferTemplate(prisma: PrismaClient, id: string) {
  const template = await prisma.offerTemplate.findUnique({ where: { id } });
  if (!template) throw new NotFoundError("Offer template not found");
  await prisma.offerTemplate.delete({ where: { id } });
  return { deleted: true };
}

// Lets the candidate-facing offer-response page show what it's asking them
// to accept/decline, without any employee login — gated purely by
// possessing the magic-link token.
export async function getOfferByToken(prisma: PrismaClient, token: string) {
  const decoded = verifyMagicLink<MagicLinkPayload & { offerId: string }>(token, OFFER_RESPOND_PURPOSE);

  const offer = await prisma.offer.findUnique({
    where: { id: decoded.offerId },
    include: { candidate: { include: { requisition: true } } },
  });
  if (!offer || offer.candidateId !== decoded.sub) {
    throw new NotFoundError("Offer not found");
  }

  return {
    status: offer.status,
    ctcBreakup: offer.ctcBreakupJson,
    candidateName: offer.candidate.name,
    requisitionTitle: offer.candidate.requisition.title,
  };
}

export async function respondOffer(prisma: PrismaClient, token: string, decision: "ACCEPT" | "DECLINE") {
  const decoded = verifyMagicLink<MagicLinkPayload & { offerId: string }>(token, OFFER_RESPOND_PURPOSE);

  const offer = await prisma.offer.findUnique({
    where: { id: decoded.offerId },
    include: { candidate: { include: { requisition: true } } },
  });
  if (!offer || offer.candidateId !== decoded.sub) {
    throw new NotFoundError("Offer not found");
  }
  if (offer.status !== "SENT") {
    throw new BadRequestError("This offer has already been responded to or is not sendable");
  }

  if (decision === "DECLINE") {
    await prisma.$transaction([
      prisma.offer.update({ where: { id: offer.id }, data: { status: "DECLINED" } }),
      prisma.candidate.update({ where: { id: offer.candidateId }, data: { currentStage: "REJECTED" } }),
    ]);
    return { status: "DECLINED" };
  }

  const [firstName, ...rest] = offer.candidate.name.trim().split(/\s+/);
  const lastName = rest.length > 0 ? rest.join(" ") : firstName;

  // Zero re-entry: the candidate's own data seeds the new Employee row
  // directly via the same employee-service create() path the rest of the
  // app uses, rather than duplicating creation logic here.
  const employee = await employeeService.create(
    prisma,
    {
      companyId: offer.candidate.requisition.companyId,
      firstName,
      lastName,
      personalEmail: offer.candidate.email,
      phone: offer.candidate.phone ?? undefined,
      departmentId: offer.candidate.requisition.departmentId,
      reportingManagerId: offer.candidate.requisition.hiringManagerId,
      status: "PREBOARDING",
    } as never,
    "system:ats",
  );

  await prisma.$transaction([
    prisma.offer.update({
      where: { id: offer.id },
      data: { status: "ACCEPTED", acceptedAt: new Date(), createdEmployeeId: employee.id },
    }),
    prisma.candidate.update({ where: { id: offer.candidateId }, data: { currentStage: "HIRED" } }),
  ]);

  let preboardingLink: string | undefined;
  try {
    await onboardingService.initChecklist(prisma, employee.id);
    preboardingLink = onboardingService.issuePreboardingLink(employee.id);

    // Emailed in addition to the on-page link shown on this same
    // offer-response screen, since the candidate may close the browser or
    // return to this link days later — the mailed copy is a durable
    // fallback and doubles as the "document collection" nudge.
    const baseUrl = getFrontendUrl();
    const preboardingUrl = `${baseUrl}/preboard?token=${preboardingLink}`;
    await sendEmail({
      to: offer.candidate.email,
      subject: "Welcome aboard — complete your preboarding",
      text: [
        `Hi ${offer.candidate.name},`,
        "",
        "Welcome aboard! Please complete your preboarding by submitting the required documents:",
        `${preboardingUrl}`,
        "",
        "This link expires in 30 days.",
      ].join("\n"),
    });
  } catch (err) {
    // A missing template shouldn't roll back a real, already-created
    // Employee record — HR can run the init-checklist route manually once
    // a template exists.
    console.warn(`Could not auto-create onboarding checklist for employee ${employee.id}:`, err instanceof Error ? err.message : String(err));
    await notify(prisma, {
      recipientId: offer.candidate.requisition.hiringManagerId,
      template: "ats.preboarding-init-failed",
      body: `Could not auto-create the onboarding checklist for ${offer.candidate.name}. Please run it manually.`,
      data: { employeeId: employee.id },
    });
  }

  await notify(prisma, {
    recipientId: offer.candidate.requisition.hiringManagerId,
    template: "ats.offer-accepted",
    body: `${offer.candidate.name} accepted the offer for "${offer.candidate.requisition.title}".`,
    data: { candidateId: offer.candidateId, employeeId: employee.id },
  });

  return { status: "ACCEPTED", employeeId: employee.id, preboardingLink };
}

export async function getPipelineAnalytics(prisma: PrismaClient, requisitionId: string) {
  const candidates = await prisma.candidate.findMany({ where: { requisitionId } });
  const stages: CandidateStage[] = ["APPLIED", "SCREENING", "INTERVIEW", "OFFER", "HIRED", "REJECTED"];
  const byStage = stages.reduce<Record<string, number>>((acc, stage) => {
    acc[stage] = candidates.filter((c) => c.currentStage === stage).length;
    return acc;
  }, {});

  const requisition = await prisma.jobRequisition.findUnique({ where: { id: requisitionId } });
  const acceptedOffers = await prisma.offer.findMany({
    where: { candidate: { requisitionId }, status: "ACCEPTED", acceptedAt: { not: null } },
  });

  let timeToFillDays: number | null = null;
  if (requisition?.approvedAt && acceptedOffers.length > 0) {
    const msPerDay = 24 * 60 * 60 * 1000;
    const totalDays = acceptedOffers.reduce((sum, o) => sum + (o.acceptedAt!.getTime() - requisition.approvedAt!.getTime()) / msPerDay, 0);
    timeToFillDays = Math.round(totalDays / acceptedOffers.length);
  }

  return { totalCandidates: candidates.length, byStage, timeToFillDays };
}
