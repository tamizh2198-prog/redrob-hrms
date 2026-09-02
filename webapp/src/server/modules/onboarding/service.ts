import type { PrismaClient, Role } from "@prisma/client";
import { ChecklistOwnerRole, ChecklistStatus, ChecklistTaskStatus, ProbationCheckpoint } from "@prisma/client";
import { getOrCreateDefaultCompanyId } from "../../lib/default-company";
import { notify } from "../../lib/notify";
import { sendEmail } from "../../lib/email";
import { signMagicLink, verifyMagicLink } from "../../lib/auth";
import { assertCanAccessEmployeeData, type EmployeeDataRequester } from "../../lib/reporting-hierarchy";
import { BadRequestError, NotFoundError } from "../../lib/errors";
import type { CreateTemplateDto, SubmitProbationFeedbackDto } from "./dto";

// Section 7.7 Business Rules: "cannot move from 'Preboarding' to 'Active'
// until all mandatory checklist items (documents + statutory forms) are
// marked complete."
const MANDATORY_PREBOARDING_FIELDS = [
  "ID_PROOF",
  "EDUCATION_CERTIFICATE",
  "BANK_DETAILS",
  "BACKGROUND_CHECK_CONSENT",
];

const PREBOARDING_PORTAL_PURPOSE = "preboarding-portal";

export const PROBATION_CHECKPOINT_DAYS: Record<ProbationCheckpoint, number> = {
  DAY_30: 30,
  DAY_60: 60,
  DAY_90: 90,
};

// The only call site of this is completeTask's on-behalf override (data
// entry, not a decision on a request), so HR_ASSOCIATE is safely included.
function isPrivileged(role?: Role): boolean {
  return role === "HR_ADMIN" || role === "SUPER_ADMIN" || role === "HR_ASSOCIATE";
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

export async function createTemplate(prisma: PrismaClient, dto: CreateTemplateDto) {
  const companyId = dto.companyId ?? (await getOrCreateDefaultCompanyId(prisma));

  // Versioned: superseding a template deactivates the old row but never
  // mutates it, so checklists already pointing at it are unaffected.
  const previous = await prisma.onboardingChecklistTemplate.findFirst({
    where: {
      companyId,
      name: dto.name,
      departmentId: dto.departmentId ?? null,
      isActive: true,
    },
  });
  if (previous) {
    await prisma.onboardingChecklistTemplate.update({
      where: { id: previous.id },
      data: { isActive: false },
    });
  }

  // A re-versioned template inherits the previous version's isDefault
  // unless explicitly overridden — otherwise superseding today's default
  // template (without remembering to re-tick "default") would silently
  // leave the company with no auto-selectable fallback at all.
  const isDefault = dto.isDefault ?? previous?.isDefault ?? false;
  if (isDefault && !dto.departmentId) {
    // Exactly one company-wide template holds this flag at a time.
    await prisma.onboardingChecklistTemplate.updateMany({
      where: { companyId, departmentId: null, isDefault: true },
      data: { isDefault: false },
    });
  }

  return prisma.onboardingChecklistTemplate.create({
    data: {
      companyId,
      name: dto.name,
      departmentId: dto.departmentId,
      isDefault,
      version: (previous?.version ?? 0) + 1,
      taskTemplates: {
        create: dto.tasks.map((t) => ({
          ownerRole: t.ownerRole,
          phase: t.phase,
          description: t.description,
          dueOffsetDays: t.dueOffsetDays ?? 0,
        })),
      },
    },
    include: { taskTemplates: true },
  });
}

export function listTemplates(prisma: PrismaClient) {
  return prisma.onboardingChecklistTemplate.findMany({
    where: { isActive: true },
    include: { taskTemplates: true },
  });
}

async function findApplicableTemplate(prisma: PrismaClient, companyId: string, departmentId: string | null) {
  if (departmentId) {
    const byDepartment = await prisma.onboardingChecklistTemplate.findFirst({
      where: { companyId, departmentId, isActive: true },
      include: { taskTemplates: true },
    });
    if (byDepartment) return byDepartment;
  }
  // isDefault (not just isActive) keeps this deterministic now that a
  // company can have several active company-wide templates in its
  // library — only the one explicitly flagged default is ever
  // auto-selected here.
  return prisma.onboardingChecklistTemplate.findFirst({
    where: {
      companyId,
      departmentId: null,
      isActive: true,
      isDefault: true,
    },
    include: { taskTemplates: true },
  });
}

// Section 7.7 Key Features: "auto-assigned on hire, with tasks split across
// HR, IT, Manager and the new hire." Idempotent — calling this twice for the
// same employee returns the existing checklist rather than failing on the
// employeeId unique constraint. `templateId` lets an HR Admin pick a
// specific template from the library when starting onboarding manually; the
// automatic ATS offer-accept trigger never passes one, so it always goes
// through the same auto-resolution as before (findApplicableTemplate's
// isDefault-scoped fallback).
export async function initChecklist(prisma: PrismaClient, employeeId: string, templateId?: string) {
  const existing = await prisma.onboardingChecklist.findUnique({
    where: { employeeId },
    include: { tasks: true },
  });
  if (existing) return existing;

  const employee = await prisma.employee.findUnique({ where: { id: employeeId } });
  if (!employee) throw new NotFoundError("Employee not found");
  // Only a PREBOARDING employee can ever pass activateEmployee()'s own
  // status check below — creating a checklist for anyone else (e.g. an
  // INVITED employee picked from the full roster) produces a checklist
  // that can never be activated, permanently throwing "This employee is
  // not in Preboarding status" the moment someone clicks Activate on it.
  if (employee.status !== "PREBOARDING") {
    throw new BadRequestError("Onboarding checklists can only be started for employees in Preboarding status");
  }

  const template = templateId
    ? await prisma.onboardingChecklistTemplate.findFirst({
        where: { id: templateId, companyId: employee.companyId, isActive: true },
        include: { taskTemplates: true },
      })
    : await findApplicableTemplate(prisma, employee.companyId, employee.departmentId);
  if (!template) {
    throw new NotFoundError(
      templateId
        ? "The selected onboarding checklist template was not found"
        : "No onboarding checklist template configured for this department",
    );
  }

  const checklist = await prisma.onboardingChecklist.create({
    data: {
      employeeId,
      templateId: template.id,
      status: ChecklistStatus.IN_PROGRESS,
      tasks: {
        create: template.taskTemplates.map((t) => ({
          ownerRole: t.ownerRole,
          phase: t.phase,
          description: t.description,
          dueDate: employee.dateOfJoining ? addDays(employee.dateOfJoining, t.dueOffsetDays) : null,
        })),
      },
    },
    include: { tasks: true },
  });

  await notify(prisma, {
    recipientId: employeeId,
    template: "onboarding.checklist-created",
    body: "Your onboarding checklist has been created. Please complete your preboarding tasks.",
    data: { checklistId: checklist.id },
  });

  const ownerNotifyTargets = new Set<string>();
  for (const task of checklist.tasks) {
    if (task.ownerRole === ChecklistOwnerRole.MANAGER && employee.reportingManagerId) {
      ownerNotifyTargets.add(employee.reportingManagerId);
    }
    if (task.ownerRole === ChecklistOwnerRole.HR || task.ownerRole === ChecklistOwnerRole.IT) {
      // No dedicated IT-admin recipient exists yet — broadcast to the same
      // HR sentinel used elsewhere in the codebase until per-role
      // distribution lists exist.
      ownerNotifyTargets.add("hr-admin");
    }
  }
  await Promise.all(
    [...ownerNotifyTargets].map((recipientId) =>
      notify(prisma, {
        recipientId,
        template: "onboarding.tasks-assigned",
        body: `You have onboarding checklist tasks assigned for ${employee.firstName} ${employee.lastName}.`,
        data: { employeeId, checklistId: checklist.id },
      }),
    ),
  );

  return checklist;
}

// Not exposed as its own route — called cross-module by the (future) ATS
// offer-accept flow, mirroring the original NestJS service export used only
// by AtsModule.
export function issuePreboardingLink(employeeId: string): string {
  return signMagicLink({ sub: employeeId, purpose: PREBOARDING_PORTAL_PURPOSE }, "30d");
}

// HR-facing "resend the portal link" action — the link itself is a stateless
// JWT (see issuePreboardingLink), so there's no prior token to invalidate;
// resending is just minting a fresh one and emailing it again. Modeled on
// ats/service.ts's respondOffer, which sends this same link via sendEmail()
// directly rather than notify()/dispatch() — a Preboarding-status employee
// usually has no workEmail yet, which is what dispatch()'s critical-email
// path requires.
export async function resendPreboardingLink(prisma: PrismaClient, employeeId: string) {
  const employee = await prisma.employee.findUnique({ where: { id: employeeId } });
  if (!employee) throw new NotFoundError("Employee not found");
  if (employee.status !== "PREBOARDING") {
    throw new BadRequestError("This employee is not in Preboarding status");
  }
  const recipient = employee.personalEmail ?? employee.workEmail;
  if (!recipient) {
    throw new BadRequestError("This employee has no email on file to send the link to");
  }

  const token = issuePreboardingLink(employeeId);
  const baseUrl = process.env.FRONTEND_URL ?? "http://localhost:3000";
  const preboardingUrl = `${baseUrl}/preboard?token=${token}`;
  const result = await sendEmail({
    to: recipient,
    subject: "Your Redrob HRMS preboarding portal link",
    text: [
      `Hi ${employee.firstName},`,
      "",
      "Here is your preboarding portal link:",
      preboardingUrl,
      "",
      "This link expires in 30 days.",
    ].join("\n"),
  });

  // Same "hand back the raw URL only when email didn't actually send" idiom
  // as employee/service.ts's resendInvitation — drives the same copy-link
  // fallback UI already used there.
  return { emailSent: result.sent, preboardingUrl: result.sent ? undefined : preboardingUrl };
}

export function getProgressViaPortal(prisma: PrismaClient, token: string) {
  const { sub: employeeId } = verifyMagicLink(token, PREBOARDING_PORTAL_PURPOSE);
  // The magic link is already scoped to this one employeeId — that's the
  // authorization check for the portal, so this is inherently self-access.
  return getProgress(prisma, employeeId, { userId: employeeId });
}

export async function getProgress(prisma: PrismaClient, employeeId: string, requester: EmployeeDataRequester) {
  await assertCanAccessEmployeeData(prisma, employeeId, requester);
  const checklist = await prisma.onboardingChecklist.findUnique({
    where: { employeeId },
    include: { tasks: true },
  });
  if (!checklist) throw new NotFoundError("No onboarding checklist for this employee");

  const total = checklist.tasks.length;
  const completed = checklist.tasks.filter((t) => t.status === ChecklistTaskStatus.COMPLETED).length;

  return {
    checklist,
    completionPercent: total === 0 ? 0 : Math.round((completed / total) * 100),
    missingMandatoryFields: await getMissingMandatoryFields(prisma, employeeId),
  };
}

async function markChecklistCompleteIfDone(prisma: PrismaClient, checklistId: string) {
  const remaining = await prisma.checklistTask.count({
    where: { checklistId, status: ChecklistTaskStatus.PENDING },
  });
  if (remaining === 0) {
    await prisma.onboardingChecklist.update({
      where: { id: checklistId },
      data: { status: ChecklistStatus.COMPLETED },
    });
  }
}

export async function completeTask(prisma: PrismaClient, taskId: string, actorId: string, actorRole?: Role) {
  const task = await prisma.checklistTask.findUnique({
    where: { id: taskId },
    include: { checklist: { include: { employee: true } } },
  });
  if (!task) throw new NotFoundError("Checklist task not found");
  if (task.status === ChecklistTaskStatus.COMPLETED) return task;

  if (task.ownerRole === ChecklistOwnerRole.NEW_HIRE) {
    throw new BadRequestError("New-hire tasks are completed through the preboarding portal, not this endpoint");
  }
  if (
    task.ownerRole === ChecklistOwnerRole.MANAGER &&
    !isPrivileged(actorRole) &&
    (actorRole !== "MANAGER" || task.checklist.employee.reportingManagerId !== actorId)
  ) {
    throw new BadRequestError("Only the assigned manager can complete this task");
  }
  if (
    (task.ownerRole === ChecklistOwnerRole.HR || task.ownerRole === ChecklistOwnerRole.IT) &&
    !isPrivileged(actorRole)
  ) {
    throw new BadRequestError("Only HR Admin can complete this task");
  }

  const updated = await prisma.checklistTask.update({
    where: { id: taskId },
    data: {
      status: ChecklistTaskStatus.COMPLETED,
      completedBy: actorId,
      completedAt: new Date(),
    },
  });

  await markChecklistCompleteIfDone(prisma, task.checklistId);
  return updated;
}

export async function completeTaskViaPortal(prisma: PrismaClient, taskId: string, token: string) {
  const { sub: employeeId } = verifyMagicLink(token, PREBOARDING_PORTAL_PURPOSE);

  const task = await prisma.checklistTask.findUnique({
    where: { id: taskId },
    include: { checklist: true },
  });
  if (!task) throw new NotFoundError("Checklist task not found");
  if (task.checklist.employeeId !== employeeId) {
    throw new BadRequestError("This task does not belong to this preboarding portal");
  }
  if (task.ownerRole !== ChecklistOwnerRole.NEW_HIRE) {
    throw new BadRequestError("This task is not assigned to the new hire");
  }
  if (task.status === ChecklistTaskStatus.COMPLETED) return task;

  const updated = await prisma.checklistTask.update({
    where: { id: taskId },
    data: {
      status: ChecklistTaskStatus.COMPLETED,
      completedBy: employeeId,
      completedAt: new Date(),
    },
  });

  await markChecklistCompleteIfDone(prisma, task.checklistId);
  return updated;
}

export async function submitPreboarding(prisma: PrismaClient, token: string, fieldType: string, valueRef: string) {
  const { sub: employeeId } = verifyMagicLink(token, PREBOARDING_PORTAL_PURPOSE);

  const employee = await prisma.employee.findUnique({ where: { id: employeeId } });
  if (!employee) throw new NotFoundError("Employee not found");
  if (employee.status !== "PREBOARDING") {
    throw new BadRequestError("The preboarding portal is closed for this employee");
  }

  // No compound unique key on (employeeId, fieldType) — resubmitting the
  // same field type updates the existing row instead of piling up rows.
  const existing = await prisma.preboardingSubmission.findFirst({ where: { employeeId, fieldType } });

  const submission = existing
    ? await prisma.preboardingSubmission.update({
        where: { id: existing.id },
        data: { valueRef, submittedAt: new Date(), verifiedBy: null, verifiedAt: null },
      })
    : await prisma.preboardingSubmission.create({ data: { employeeId, fieldType, valueRef } });

  await notify(prisma, {
    recipientId: "hr-admin",
    template: "onboarding.preboarding-submitted",
    body: `${employee.firstName} ${employee.lastName} submitted their ${fieldType} preboarding document.`,
    data: { employeeId, fieldType },
  });

  return submission;
}

async function getMissingMandatoryFields(prisma: PrismaClient, employeeId: string): Promise<string[]> {
  const submissions = await prisma.preboardingSubmission.findMany({
    where: { employeeId, fieldType: { in: MANDATORY_PREBOARDING_FIELDS } },
    select: { fieldType: true },
  });
  const present = new Set(submissions.map((s) => s.fieldType));
  return MANDATORY_PREBOARDING_FIELDS.filter((f) => !present.has(f));
}

export async function activateEmployee(prisma: PrismaClient, employeeId: string, actorId: string) {
  const employee = await prisma.employee.findUnique({ where: { id: employeeId } });
  if (!employee) throw new NotFoundError("Employee not found");
  if (employee.status !== "PREBOARDING") {
    throw new BadRequestError("This employee is not in Preboarding status");
  }

  const missing = await getMissingMandatoryFields(prisma, employeeId);
  if (missing.length > 0) {
    throw new BadRequestError(`Cannot activate: missing mandatory preboarding items: ${missing.join(", ")}`);
  }

  await prisma.$transaction([
    prisma.employee.update({
      where: { id: employeeId },
      data: { status: "ACTIVE_PROBATION" },
    }),
    prisma.employeeHistory.create({
      data: {
        employeeId,
        fieldChanged: "status",
        oldValue: "PREBOARDING",
        newValue: "ACTIVE_PROBATION",
        changedBy: actorId,
      },
    }),
    // Ending Preboarding retires the checklist regardless of any leftover
    // non-mandatory HR/IT/Manager task — otherwise a checklist with even
    // one incomplete task stays in listActiveChecklists() forever (it only
    // filters by ChecklistStatus, never by the employee's own status), and
    // clicking "Activate" again on that same stale row is exactly what
    // throws "This employee is not in Preboarding status".
    prisma.onboardingChecklist.updateMany({
      where: { employeeId, status: { not: ChecklistStatus.COMPLETED } },
      data: { status: ChecklistStatus.COMPLETED },
    }),
    // Pre-created child row per checkpoint — reminderSentAt stays null
    // until the probation-feedback-reminder sweep decides day 30/60/90 has
    // actually arrived.
    prisma.probationFeedback.createMany({
      data: (Object.keys(PROBATION_CHECKPOINT_DAYS) as ProbationCheckpoint[]).map((checkpoint) => ({
        employeeId,
        checkpoint,
      })),
    }),
  ]);

  await notify(prisma, {
    recipientId: employeeId,
    template: "onboarding.employee-activated",
    body: "Your onboarding is complete and your account is now fully active.",
  });

  return { status: "ACTIVE_PROBATION" };
}

export function listMyProbationFeedback(prisma: PrismaClient, employeeId: string) {
  return prisma.probationFeedback.findMany({
    where: { employeeId },
    orderBy: { checkpoint: "asc" },
  });
}

export async function submitProbationFeedback(
  prisma: PrismaClient,
  id: string,
  actorId: string,
  dto: SubmitProbationFeedbackDto,
) {
  const feedback = await prisma.probationFeedback.findUnique({ where: { id } });
  if (!feedback) throw new NotFoundError("Feedback checkpoint not found");
  if (feedback.employeeId !== actorId) {
    throw new BadRequestError("This feedback checkpoint is not yours");
  }
  if (!feedback.reminderSentAt) {
    throw new BadRequestError("This checkpoint is not due yet");
  }
  if (feedback.submittedAt) {
    throw new BadRequestError("This checkpoint was already submitted");
  }

  return prisma.probationFeedback.update({
    where: { id },
    data: {
      companyRating: dto.companyRating,
      workCultureRating: dto.workCultureRating,
      comments: dto.comments,
      submittedAt: new Date(),
    },
  });
}

// HR/Super Admin-only culture/retention signal — every checkpoint an
// employee has actually answered, across everyone. Narrow select, not
// include: { employee: true } — no reason to pull passwordHash etc. here.
export function listProbationFeedback(prisma: PrismaClient) {
  return prisma.probationFeedback.findMany({
    where: { submittedAt: { not: null } },
    include: {
      employee: { select: { firstName: true, lastName: true, employeeCode: true } },
    },
    orderBy: { submittedAt: "desc" },
  });
}

export async function listActiveChecklists(prisma: PrismaClient) {
  const checklists = await prisma.onboardingChecklist.findMany({
    where: { status: { in: [ChecklistStatus.NOT_STARTED, ChecklistStatus.IN_PROGRESS] } },
    include: {
      // Scoped select, not `employee: true` — this list is HR-facing and was
      // previously leaking every employee's passwordHash to the client.
      employee: { select: { id: true, firstName: true, lastName: true, employeeCode: true } },
      tasks: true,
    },
    orderBy: { createdAt: "desc" },
  });

  return Promise.all(
    checklists.map(async (c) => ({
      ...c,
      missingMandatoryFields: await getMissingMandatoryFields(prisma, c.employeeId),
    })),
  );
}
