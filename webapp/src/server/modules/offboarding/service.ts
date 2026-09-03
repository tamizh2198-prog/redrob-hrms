import type { PrismaClient, Prisma, Role, ClearanceItemCategory, Employee, Resignation } from "@prisma/client";
import { Role as RoleEnum } from "@prisma/client";
import { notify } from "../../lib/notify";
import { sendEmail } from "../../lib/email";
import { assertCanAccessEmployeeData, type EmployeeDataRequester } from "../../lib/reporting-hierarchy";
import { BadRequestError, ForbiddenError, NotFoundError } from "../../lib/errors";
import * as assetsService from "../assets/service";
import { ACTIVE_STATUSES } from "../employee/service";
import { renderRelievingLetterPdf, type RelievingLetterData } from "./relieving-letter-pdf";
import type {
  AdjustLwdDto,
  ComputeSettlementDto,
  MarkSettlementPaidDto,
  RejectResignationDto,
  SendRelievingLetterDto,
  SignoffClearanceDto,
  SubmitExitInterviewDto,
  SubmitResignationDto,
} from "./dto";

// Normalizes to UTC midnight, not local midnight — date-only ISO strings
// parse as UTC, so a local boundary here would shift every stored date key
// by a day outside UTC+0 servers.
function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

function daysBetween(from: Date, to: Date): number {
  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  return Math.round((to.getTime() - from.getTime()) / MS_PER_DAY);
}

// Decision/sign-off authority (adjustLwd, signoffClearance) — HR_ASSOCIATE
// deliberately excluded, unlike isHrStaff below.
function isPrivileged(role?: Role): boolean {
  return role === "HR_ADMIN" || role === "SUPER_ADMIN";
}

// General visibility/on-behalf-of overrides (submitResignation,
// submitExitInterview) — mirrors HR_ADMIN's access without granting
// LWD-adjustment or clearance sign-off authority.
function isHrStaff(role?: Role): boolean {
  return isPrivileged(role) || role === "HR_ASSOCIATE";
}

// HRMS-19 fix: offboarding notifications used to be addressed to the
// literal string "hr-admin", which is not an employee id — dispatch() would
// look it up, find nothing, and silently no-op, so HR was never actually
// notified of a resignation, its acceptance, or a settlement reaching
// PENDING_APPROVAL. Resolves the real recipient set at dispatch time instead
// so the notification module has an actual employee to deliver to.
async function getHrAdminRecipientIds(prisma: PrismaClient): Promise<string[]> {
  const hrAdmins = await prisma.employee.findMany({
    where: { role: RoleEnum.HR_ADMIN, status: { in: ACTIVE_STATUSES } },
    select: { id: true },
  });
  return hrAdmins.map((e) => e.id);
}

// The company's actual Separation Clearance Checklist: items verified by the
// Community POC/Lead, plus the exiting employee's own self-declaration
// section. `key` is the stable machine identifier this service branches on
// (see the asset-return gate in signoffClearance below); `label` mirrors the
// document's wording as closely as possible without embedding any
// company-internal credential value.
export const CLEARANCE_ITEMS: { key: string; label: string; category: ClearanceItemCategory }[] = [
  { key: "ID_CARD", label: "ID Card", category: "LEAD_VERIFICATION" },
  { key: "BIOMETRIC_ID", label: "Biometric ID Stopped", category: "LEAD_VERIFICATION" },
  { key: "OFFICE_KEYS", label: "Office Keys (desk, drawers, filing cabinets, etc.)", category: "LEAD_VERIFICATION" },
  {
    key: "OFFICE_EQUIPMENT",
    label: "Office Equipment (computer/laptop, headphones, mouse, etc.)",
    category: "LEAD_VERIFICATION",
  },
  { key: "EQUIPMENT_HANDOVER", label: "Equipment Handover To (Name, Date)", category: "LEAD_VERIFICATION" },
  { key: "MOBILE_EQUIPMENT", label: "Mobile and Allied Equipment (SIM)", category: "LEAD_VERIFICATION" },
  { key: "VEHICLES", label: "Vehicles/Transport Equipment", category: "LEAD_VERIFICATION" },
  { key: "TOOLS_ACCESS", label: "Tools Access Revoked", category: "LEAD_VERIFICATION" },
  { key: "MANUALS_BOOKS", label: "Manuals and Books", category: "LEAD_VERIFICATION" },
  { key: "VISITING_CARDS", label: "Visiting Cards", category: "LEAD_VERIFICATION" },
  { key: "DESIGN_DATA", label: "Design or Development Data", category: "LEAD_VERIFICATION" },
  { key: "SYSTEM_ACCESS", label: "G-Drive, Slack, and Git Access Removed", category: "LEAD_VERIFICATION" },
  { key: "SHARED_PASSWORD", label: "Shared/Generic Account Password Changed", category: "LEAD_VERIFICATION" },
  {
    key: "SOFTWARE_SIGNIN",
    label: "Software Sign-In Details Revoked (Adobe, Autodesk, etc.)",
    category: "LEAD_VERIFICATION",
  },
  { key: "FORWARDING_ADDRESS", label: "Forwarding Address Provided", category: "EMPLOYEE_DECLARATION" },
  {
    key: "HANDOVER_CONFIRMED",
    label: "Work/Account Details Handed Over to Supervisor",
    category: "EMPLOYEE_DECLARATION",
  },
  { key: "TAX_PAPERS", label: "Income Tax-Related Papers Submitted", category: "EMPLOYEE_DECLARATION" },
  {
    key: "EXIT_INTERVIEW_ATTENDED",
    label: "Exit Interview Attended (Not Required for Termination)",
    category: "EMPLOYEE_DECLARATION",
  },
];

// Key Feature: "auto-computed last working day (LWD)" and "Multi-department
// clearance checklist ... auto-generated." The checklist itself is now
// created on acceptResignation, not here — a submitted-but-not-yet-accepted
// resignation shouldn't already have a live clearance checklist (see
// acceptResignation below).
export async function submitResignation(prisma: PrismaClient, dto: SubmitResignationDto, actorId: string, actorRole?: Role) {
  const employeeId = dto.employeeId ?? actorId;
  if (employeeId !== actorId && !isHrStaff(actorRole)) {
    throw new ForbiddenError("Only the employee themselves or HR Admin can submit this resignation");
  }

  const employee = await prisma.employee.findUnique({ where: { id: employeeId } });
  if (!employee) throw new NotFoundError("Employee not found");

  const submittedDate = startOfDay(new Date());
  const lastWorkingDay = addDays(submittedDate, dto.noticePeriodDays);

  // The relieving/experience letter is sent to this address after
  // separation, once work-account access is gone — captured (or refreshed)
  // at resignation time since it's the last reliable moment to ask.
  const [, resignation] = await prisma.$transaction([
    prisma.employee.update({ where: { id: employeeId }, data: { personalEmail: dto.personalEmail } }),
    prisma.resignation.create({
      data: {
        employeeId,
        submittedDate,
        noticePeriodDays: dto.noticePeriodDays,
        lastWorkingDay,
      },
    }),
  ]);

  const notifyTargets = [employee.reportingManagerId, ...(await getHrAdminRecipientIds(prisma))].filter(
    (id): id is string => !!id,
  );
  await Promise.all(
    notifyTargets.map((recipientId) =>
      notify(prisma, {
        recipientId,
        template: "offboarding.resignation-submitted",
        body: `${employee.firstName} ${employee.lastName} submitted their resignation, pending acceptance. Last working day: ${lastWorkingDay.toISOString().slice(0, 10)}.`,
        data: { resignationId: resignation.id, employeeId },
      }),
    ),
  );

  return resignation;
}

// Fills the gap where a resignation previously started clearance
// automatically with no human decision point. Only a SUBMITTED resignation
// can be accepted — creates the clearance checklist (moved here from
// submitResignation) and notifies the employee for real (email, not just
// in-app) with the accepted LWD, since they're still actively employed and
// workEmail is reliable at this point.
export async function acceptResignation(prisma: PrismaClient, resignationId: string, actorId: string) {
  const resignation = await prisma.resignation.findUnique({
    where: { id: resignationId },
    include: { employee: true },
  });
  if (!resignation) throw new NotFoundError("Resignation not found");
  if (resignation.status !== "SUBMITTED") {
    throw new BadRequestError("Only a submitted resignation awaiting a decision can be accepted");
  }

  const updated = await prisma.resignation.update({
    where: { id: resignationId },
    data: {
      status: "CLEARANCE_IN_PROGRESS",
      clearanceItems: {
        create: CLEARANCE_ITEMS.map(({ key, label, category }) => ({ key, label, category })),
      },
    },
    include: { clearanceItems: true },
  });

  const { employee } = resignation;
  const lwd = resignation.lastWorkingDay.toISOString().slice(0, 10);

  const notifyTargets = [employee.reportingManagerId, ...(await getHrAdminRecipientIds(prisma))].filter(
    (id): id is string => !!id,
  );
  await Promise.all(
    notifyTargets.map((recipientId) =>
      notify(prisma, {
        recipientId,
        template: "offboarding.resignation-accepted",
        body: `${employee.firstName} ${employee.lastName}'s resignation was accepted. Last working day: ${lwd}.`,
        data: { resignationId, employeeId: employee.id },
      }),
    ),
  );
  await notify(prisma, {
    recipientId: employee.id,
    template: "offboarding.resignation-accepted",
    body: `Your resignation has been accepted. Your last working day is ${lwd}.`,
    data: { resignationId, acceptedBy: actorId },
  });
  if (employee.workEmail) {
    await sendEmail({
      to: employee.workEmail,
      subject: "Your resignation has been accepted",
      text: [
        `Hi ${employee.firstName},`,
        "",
        `Your resignation has been accepted. Your last working day is ${lwd}.`,
        "",
        "Please complete the separation clearance checklist before your last working day.",
      ].join("\n"),
    });
  }

  return updated;
}

export async function rejectResignation(prisma: PrismaClient, resignationId: string, dto: RejectResignationDto, actorId: string) {
  const resignation = await prisma.resignation.findUnique({ where: { id: resignationId } });
  if (!resignation) throw new NotFoundError("Resignation not found");
  if (resignation.status !== "SUBMITTED") {
    throw new BadRequestError("Only a submitted resignation awaiting a decision can be rejected");
  }

  const updated = await prisma.resignation.update({ where: { id: resignationId }, data: { status: "REJECTED" } });

  await notify(prisma, {
    recipientId: resignation.employeeId,
    template: "offboarding.resignation-rejected",
    body: `Your resignation was not accepted.${dto.reason ? ` Reason: "${dto.reason}"` : ""}`,
    data: { resignationId, rejectedBy: actorId },
  });

  return updated;
}

export async function getResignation(prisma: PrismaClient, resignationId: string, requester: EmployeeDataRequester) {
  const resignation = await prisma.resignation.findUnique({
    where: { id: resignationId },
    include: { clearanceItems: true, lwdAdjustments: true },
  });
  if (!resignation) throw new NotFoundError("Resignation not found");
  await assertCanAccessEmployeeData(prisma, resignation.employeeId, requester);
  return resignation;
}

export function listResignations(prisma: PrismaClient) {
  return prisma.resignation.findMany({
    include: {
      clearanceItems: true,
      employee: { select: { firstName: true, lastName: true, employeeCode: true } },
    },
    orderBy: { createdAt: "desc" },
  });
}

// Business Rule: "adjustable via mutual negotiation with manager+HR Admin
// sign-off and audit trail" — either the employee's manager or HR Admin can
// record the negotiated date; the row itself is the audit trail.
export async function adjustLwd(prisma: PrismaClient, resignationId: string, dto: AdjustLwdDto, actorId: string, actorRole?: Role) {
  const resignation = await prisma.resignation.findUnique({
    where: { id: resignationId },
    include: { employee: true },
  });
  if (!resignation) throw new NotFoundError("Resignation not found");

  if (resignation.employee.reportingManagerId !== actorId && !isPrivileged(actorRole)) {
    throw new ForbiddenError("Only this employee's manager or HR Admin can adjust the last working day");
  }

  const newDate = startOfDay(new Date(dto.newDate));
  const [, updated] = await prisma.$transaction([
    prisma.lwdAdjustment.create({
      data: { resignationId, previousDate: resignation.lastWorkingDay, newDate, reason: dto.reason, adjustedBy: actorId },
    }),
    prisma.resignation.update({ where: { id: resignationId }, data: { lastWorkingDay: newDate } }),
  ]);

  return updated;
}

export async function getClearanceStatus(prisma: PrismaClient, resignationId: string, requester: EmployeeDataRequester) {
  const resignation = await prisma.resignation.findUnique({ where: { id: resignationId }, select: { employeeId: true } });
  if (!resignation) throw new NotFoundError("Resignation not found");
  await assertCanAccessEmployeeData(prisma, resignation.employeeId, requester);
  return prisma.clearanceItem.findMany({ where: { resignationId } });
}

// Acceptance Criteria: "Offboarding IT Clearance is programmatically
// blocked while unreturned assets exist" — the actual cross-module check
// lives here, reading the assets service directly rather than duplicating
// custody logic. Keyed on the OFFICE_EQUIPMENT checklist item rather than a
// department, matching the real checklist.
//
// Separation Clearance Checklist RBAC: LEAD_VERIFICATION items are "To be
// verified by Community POC & Lead" (this employee's manager, or HR);
// EMPLOYEE_DECLARATION items are the exiting employee's own self-declared
// section (the employee themselves, or HR as a privileged override).
export async function signoffClearance(prisma: PrismaClient, itemId: string, dto: SignoffClearanceDto, actorId: string, actorRole?: Role) {
  const item = await prisma.clearanceItem.findUnique({
    where: { id: itemId },
    include: {
      resignation: {
        include: { employee: { include: { department: true, designation: true, location: true } } },
      },
    },
  });
  if (!item) throw new NotFoundError("Clearance item not found");
  if (item.status === "SIGNED_OFF") {
    throw new BadRequestError("This clearance item is already signed off");
  }

  if (!isPrivileged(actorRole)) {
    if (item.category === "LEAD_VERIFICATION") {
      if (item.resignation.employee.reportingManagerId !== actorId) {
        throw new ForbiddenError("Only this employee's manager or HR Admin can verify this item");
      }
    } else if (item.resignation.employeeId !== actorId) {
      throw new ForbiddenError("Only the exiting employee or HR Admin can confirm this item");
    }
  }

  if (item.key === "OFFICE_EQUIPMENT") {
    const blocked = await assetsService.hasUnreturnedAssets(prisma, item.resignation.employeeId);
    if (blocked) {
      throw new BadRequestError("This item is blocked until every asset issued to this employee is returned or transferred");
    }
  }

  const updated = await prisma.clearanceItem.update({
    where: { id: itemId },
    data: { status: "SIGNED_OFF", signedOffBy: actorId, signedOffAt: new Date(), remarks: dto.remarks },
  });

  const remaining = await prisma.clearanceItem.count({
    where: { resignationId: item.resignationId, status: "PENDING" },
  });
  if (remaining === 0) {
    // "HRMS should create a relieving & experience letter for the employee
    // ... wherever bracket was mentioned" — snapshot the merge fields now,
    // frozen against later edits to the employee's record, and make it
    // available for Super Admin review (letterStatus). The PDF itself is
    // rendered on demand from this snapshot, not stored.
    const snapshot = buildLetterSnapshot(item.resignation.employee, item.resignation);
    await prisma.resignation.update({
      where: { id: item.resignationId },
      data: {
        status: "CLEARED",
        letterStatus: "PENDING_VERIFICATION",
        letterDataSnapshot: snapshot as unknown as Prisma.InputJsonValue,
      },
    });
  }

  return updated;
}

type EmployeeWithLetterRelations = Employee & {
  department: { name: string } | null;
  designation: { name: string } | null;
  location: { name: string } | null;
};

function formatDate(date: Date | null): string {
  return date ? date.toISOString().slice(0, 10) : "—";
}

function buildLetterSnapshot(employee: EmployeeWithLetterRelations, resignation: Resignation): RelievingLetterData {
  return {
    employeeName: `${employee.firstName} ${employee.lastName}`,
    employeeCode: employee.employeeCode,
    dateOfJoining: formatDate(employee.dateOfJoining),
    lastWorkingDay: formatDate(resignation.lastWorkingDay),
    designation: employee.designation?.name ?? "—",
    location: employee.location?.name ?? "—",
    department: employee.department?.name ?? "—",
    gender: employee.gender,
    generatedDate: formatDate(new Date()),
  };
}

export async function submitExitInterview(prisma: PrismaClient, resignationId: string, dto: SubmitExitInterviewDto, actorId: string, actorRole?: Role) {
  const resignation = await prisma.resignation.findUnique({ where: { id: resignationId } });
  if (!resignation) throw new NotFoundError("Resignation not found");
  if (resignation.employeeId !== actorId && !isHrStaff(actorRole)) {
    throw new ForbiddenError("Only the exiting employee or HR Admin can submit this exit interview");
  }

  const conductedBy = isHrStaff(actorRole) ? actorId : null;
  return prisma.exitInterview.upsert({
    where: { resignationId },
    update: { responsesJson: dto.responses as Prisma.InputJsonValue, conductedBy, submittedAt: new Date() },
    create: {
      resignationId,
      employeeId: resignation.employeeId,
      responsesJson: dto.responses as Prisma.InputJsonValue,
      conductedBy,
      submittedAt: new Date(),
    },
  });
}

// Business Rule: "F&F settlement automatically pulls: unreturned/damaged
// asset cost (Asset module), and any notice-period shortfall recovery — no
// manual re-entry." Leave encashment no longer applies (Leave module
// removed); the field stays at 0.
export async function computeSettlement(prisma: PrismaClient, resignationId: string, dto: ComputeSettlementDto) {
  const resignation = await prisma.resignation.findUnique({ where: { id: resignationId } });
  if (!resignation) throw new NotFoundError("Resignation not found");

  const leaveEncashment = 0;

  const assetRecovery = await assetsService.getRecoverableAssetCost(prisma, resignation.employeeId);

  const requiredLwd = addDays(startOfDay(resignation.submittedDate), resignation.noticePeriodDays);
  const shortfallDays = Math.max(0, daysBetween(startOfDay(resignation.lastWorkingDay), requiredLwd));
  const noticeRecovery = shortfallDays * dto.perDayPayRate;

  const pendingSalary = dto.pendingSalary ?? 0;
  const netPayable = pendingSalary + leaveEncashment - noticeRecovery - assetRecovery;

  const settlement = await prisma.finalSettlement.upsert({
    where: { resignationId },
    update: {
      pendingSalary,
      leaveEncashment,
      noticeRecovery,
      assetRecovery,
      netPayable,
      status: "PENDING_APPROVAL",
      computedAt: new Date(),
    },
    create: {
      resignationId,
      employeeId: resignation.employeeId,
      pendingSalary,
      leaveEncashment,
      noticeRecovery,
      assetRecovery,
      netPayable,
      status: "PENDING_APPROVAL",
    },
  });

  const settlementNotifyTargets = await getHrAdminRecipientIds(prisma);
  await Promise.all(
    settlementNotifyTargets.map((recipientId) =>
      notify(prisma, {
        recipientId,
        template: "offboarding.settlement-computed",
        body: `The final settlement for resignation ${resignationId} has been computed (net payable: ${netPayable}) and is awaiting approval.`,
        data: { resignationId, netPayable },
      }),
    ),
  );

  return settlement;
}

export async function approveSettlement(prisma: PrismaClient, resignationId: string, actorId: string) {
  const settlement = await prisma.finalSettlement.findUnique({ where: { resignationId } });
  if (!settlement) throw new NotFoundError("Settlement not computed yet");
  if (settlement.status !== "PENDING_APPROVAL") {
    throw new BadRequestError("Only a settlement pending approval can be approved");
  }

  return prisma.finalSettlement.update({
    where: { resignationId },
    data: { status: "APPROVED", approvedBy: actorId, approvedAt: new Date() },
  });
}

// Business Rule: "Employee status moves to 'Archived' only after F&F is
// marked paid/settled."
export async function markSettlementPaid(prisma: PrismaClient, resignationId: string, dto: MarkSettlementPaidDto, actorId: string) {
  const settlement = await prisma.finalSettlement.findUnique({ where: { resignationId } });
  if (!settlement) throw new NotFoundError("Settlement not computed yet");
  if (settlement.status !== "APPROVED") {
    throw new BadRequestError("The settlement must be approved before it can be marked paid");
  }

  const resignation = await prisma.resignation.findUnique({ where: { id: resignationId } });
  if (!resignation) throw new NotFoundError("Resignation not found");
  const employee = await prisma.employee.findUnique({ where: { id: resignation.employeeId } });
  if (!employee) throw new NotFoundError("Employee not found");

  await prisma.$transaction([
    prisma.finalSettlement.update({ where: { resignationId }, data: { status: "PAID", paidAt: new Date() } }),
    prisma.resignation.update({
      where: { id: resignationId },
      data: { status: "ARCHIVED", rehireEligible: dto.rehireEligible ?? resignation.rehireEligible },
    }),
    prisma.employee.update({ where: { id: employee.id }, data: { status: "ARCHIVED" } }),
    prisma.employeeHistory.create({
      data: { employeeId: employee.id, fieldChanged: "status", oldValue: employee.status, newValue: "ARCHIVED", changedBy: actorId },
    }),
    // Same session-revocation gap as dismissEmployee — ARCHIVED is at least
    // as terminal as TERMINATED, so an existing refresh token/trusted
    // device shouldn't outlive it either.
    prisma.refreshToken.updateMany({ where: { employeeId: employee.id, revokedAt: null }, data: { revokedAt: new Date() } }),
    prisma.trustedDevice.deleteMany({ where: { employeeId: employee.id } }),
  ]);

  return { status: "ARCHIVED" };
}

// Renders the PDF from the snapshot signoffClearance already froze when the
// checklist completed — no state change, Super Admin-only preview before
// deciding to send.
export async function previewRelievingLetter(prisma: PrismaClient, resignationId: string): Promise<Buffer> {
  const resignation = await prisma.resignation.findUnique({ where: { id: resignationId } });
  if (!resignation) throw new NotFoundError("Resignation not found");
  if (!resignation.letterDataSnapshot) {
    throw new BadRequestError("The letter hasn't been generated yet — it's created once the separation clearance checklist is fully signed off");
  }
  return renderRelievingLetterPdf(resignation.letterDataSnapshot as unknown as RelievingLetterData);
}

// "Post verification of the super admin, then it will be sent automatically
// to that user's personal mail" — renders the same frozen snapshot Super
// Admin just previewed and emails it as a real PDF attachment.
export async function sendRelievingLetter(prisma: PrismaClient, resignationId: string, dto: SendRelievingLetterDto, actorId: string) {
  const resignation = await prisma.resignation.findUnique({ where: { id: resignationId }, include: { employee: true } });
  if (!resignation) throw new NotFoundError("Resignation not found");
  if (resignation.letterStatus !== "PENDING_VERIFICATION") {
    throw new BadRequestError("This letter is not awaiting verification — it may already be sent, or not generated yet");
  }
  const { employee } = resignation;
  if (!employee.personalEmail) {
    throw new BadRequestError("This employee has no personal email on file to send the letter to");
  }

  const pdf = await renderRelievingLetterPdf(resignation.letterDataSnapshot as unknown as RelievingLetterData);

  await sendEmail({
    to: employee.personalEmail,
    subject: "Your Relieving & Experience Letter",
    text: [
      `Hi ${employee.firstName},`,
      "",
      "Please find attached your relieving and experience letter.",
      "",
      "We wish you all the best for your future endeavours.",
    ].join("\n"),
    attachments: [{ filename: `relieving-letter-${resignationId}.pdf`, content: pdf.toString("base64") }],
  });

  const updated = await prisma.resignation.update({
    where: { id: resignationId },
    data: {
      letterStatus: "SENT",
      lettersGeneratedAt: new Date(),
      certificateReleasedBy: actorId,
      closingRemarks: dto.closingRemarks,
    },
  });

  await notify(prisma, {
    recipientId: resignation.employeeId,
    template: "offboarding.relieving-letter-sent",
    body: "Your relieving letter and experience letter have been emailed to your personal email address.",
    data: { resignationId },
  });

  return updated;
}
