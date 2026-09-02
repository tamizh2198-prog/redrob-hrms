import type { PrismaClient, Role } from "@prisma/client";
import { LearningRequestStatus } from "@prisma/client";
import { notify } from "../../lib/notify";
import { BadRequestError, ForbiddenError, NotFoundError } from "../../lib/errors";
import type { LearningDecisionDto, SubmitLearningRequestDto } from "./dto";

function isPrivileged(role?: Role): boolean {
  return role === "HR_ADMIN" || role === "SUPER_ADMIN";
}

// CTC-tiered annual reimbursement cap — see the spreadsheet this was
// sourced from ("SE Reimbursement upto on submission of actuals").
function annualLimitFor(ctcLpa: number): number {
  if (ctcLpa < 15) return 30000;
  if (ctcLpa < 25) return 40000;
  if (ctcLpa < 35) return 55000;
  return 70000;
}

// Same "manager, else any HR Admin/Super Admin, else fail explicitly"
// fallback pattern used by wfo-wfh-request-service — no silent no-approver
// gap.
async function listPrivilegedIds(prisma: PrismaClient, excludeId?: string): Promise<string[]> {
  const admins = await prisma.employee.findMany({
    where: {
      role: "SUPER_ADMIN",
      ...(excludeId && { id: { not: excludeId } }),
    },
    select: { id: true },
  });
  return admins.map((a) => a.id);
}

function stripPasswordHash<T extends { employee?: Record<string, unknown> | null }>(request: T) {
  if (!request.employee) return request;
  const safeEmployee = { ...request.employee };
  delete safeEmployee.passwordHash;
  return { ...request, employee: safeEmployee };
}

interface ApproverIdFields {
  approverId: string | null;
  managerApproverId: string | null;
  finalApproverId: string | null;
}

// approverId/managerApproverId/finalApproverId are loose strings, not
// Prisma relations (same convention as WfoWfhChangeRequest.approverId) — so
// showing the manager/approver's name means a manual batch lookup rather
// than a Prisma `include`. One query for every distinct id across the whole
// result set, not one query per request.
async function withApproverNames<T extends ApproverIdFields>(prisma: PrismaClient, requests: T[]) {
  const ids = new Set<string>();
  for (const r of requests) {
    if (r.approverId) ids.add(r.approverId);
    if (r.managerApproverId) ids.add(r.managerApproverId);
    if (r.finalApproverId) ids.add(r.finalApproverId);
  }
  if (ids.size === 0) {
    return requests.map((r) => ({ ...r, approver: null, managerApprover: null, finalApprover: null }));
  }

  const employees = await prisma.employee.findMany({
    where: { id: { in: [...ids] } },
    select: { id: true, firstName: true, lastName: true },
  });
  const byId = new Map(employees.map((e) => [e.id, { firstName: e.firstName, lastName: e.lastName }]));

  return requests.map((r) => ({
    ...r,
    approver: r.approverId ? (byId.get(r.approverId) ?? null) : null,
    managerApprover: r.managerApproverId ? (byId.get(r.managerApproverId) ?? null) : null,
    finalApprover: r.finalApproverId ? (byId.get(r.finalApproverId) ?? null) : null,
  }));
}

async function computeSpendLimit(prisma: PrismaClient, employeeId: string) {
  const employee = await prisma.employee.findUnique({ where: { id: employeeId } });
  if (!employee) throw new NotFoundError("Employee not found");
  if (employee.ctcLpa == null) {
    throw new BadRequestError(
      "Your CTC must be on file before you can request learning reimbursement — contact HR.",
    );
  }

  const requestYear = new Date().getUTCFullYear();
  const annualLimit = annualLimitFor(employee.ctcLpa);
  const requests = await prisma.learningRequest.findMany({
    where: { employeeId, requestYear, status: { not: LearningRequestStatus.REJECTED } },
    select: { cost: true },
  });
  const used = requests.reduce((sum, r) => sum + r.cost, 0);

  return {
    employeeId,
    ctcLpa: employee.ctcLpa,
    requestYear,
    annualLimit,
    used,
    remaining: annualLimit - used,
  };
}

export function getMySpendLimit(prisma: PrismaClient, employeeId: string) {
  return computeSpendLimit(prisma, employeeId);
}

// Super Admin only — the complete roster, not just employees who happen to
// have a CTC on file; a missing CTC surfaces as null fields instead of
// silently dropping that employee from the table.
export async function listAllSpendLimits(prisma: PrismaClient) {
  const employees = await prisma.employee.findMany({
    select: { id: true, firstName: true, lastName: true, employeeCode: true, ctcLpa: true },
    orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
  });
  const requestYear = new Date().getUTCFullYear();
  return Promise.all(
    employees.map(async (e) => {
      const base = { firstName: e.firstName, lastName: e.lastName, employeeCode: e.employeeCode };
      if (e.ctcLpa == null) {
        return {
          ...base,
          employeeId: e.id,
          ctcLpa: null,
          requestYear,
          annualLimit: null,
          used: 0,
          remaining: null,
        };
      }
      return { ...base, ...(await computeSpendLimit(prisma, e.id)) };
    }),
  );
}

export async function submitRequest(
  prisma: PrismaClient,
  employeeId: string,
  dto: SubmitLearningRequestDto,
  actorRole?: Role,
) {
  const employee = await prisma.employee.findUnique({ where: { id: employeeId } });
  if (!employee) throw new NotFoundError("Employee not found");

  const limit = await computeSpendLimit(prisma, employeeId);
  if (dto.cost > limit.remaining) {
    throw new BadRequestError(
      `This course costs more than your remaining learning budget for the year (₹${limit.remaining} left of ₹${limit.annualLimit}).`,
    );
  }

  const requestYear = limit.requestYear;

  // A Super Admin's own request needs nobody's approval.
  if (actorRole === "SUPER_ADMIN") {
    return prisma.learningRequest.create({
      data: {
        employeeId,
        ...dto,
        requestYear,
        status: LearningRequestStatus.APPROVED,
        finalApproverId: employeeId,
        decidedAt: new Date(),
      },
    });
  }

  const approverId = employee.reportingManagerId;
  const initialStatus = approverId ? LearningRequestStatus.PENDING_MANAGER : LearningRequestStatus.PENDING_SUPER_ADMIN;

  const request = await prisma.learningRequest.create({
    data: {
      employeeId,
      ...dto,
      requestYear,
      status: initialStatus,
      approverId,
    },
  });

  if (approverId) {
    await notify(prisma, {
      recipientId: approverId,
      template: "learning.request-submitted",
      body: `${employee.firstName} ${employee.lastName} requested reimbursement for "${dto.courseName}" (₹${dto.cost}) and is awaiting your approval.`,
      data: { requestId: request.id },
    });
    // Super Admin sees this from the moment it's raised (visibility), even
    // though it isn't theirs to act on until the manager has approved it —
    // same two-step semantics as WFO/WFH requests.
    const privilegedIds = (await listPrivilegedIds(prisma)).filter((id) => id !== approverId);
    await Promise.all(
      privilegedIds.map((id) =>
        notify(prisma, {
          recipientId: id,
          template: "learning.request-submitted-fyi",
          body: `${employee.firstName} ${employee.lastName} requested reimbursement for "${dto.courseName}" (₹${dto.cost}). It is awaiting manager approval first.`,
          data: { requestId: request.id },
        }),
      ),
    );
  } else {
    // No manager on file — nothing for stage one to do.
    const privilegedIds = await listPrivilegedIds(prisma);
    await Promise.all(
      privilegedIds.map((id) =>
        notify(prisma, {
          recipientId: id,
          template: "learning.request-submitted",
          body: `${employee.firstName} ${employee.lastName} requested reimbursement for "${dto.courseName}" (₹${dto.cost}) and has no reporting manager — awaiting your approval.`,
          data: { requestId: request.id },
        }),
      ),
    );
  }

  return request;
}

interface ManagerStageRequest {
  id: string;
  employeeId: string;
  approverId: string | null;
  courseName: string;
  cost: number;
}

async function decideManagerStage(
  prisma: PrismaClient,
  request: ManagerStageRequest,
  actorId: string,
  dto: LearningDecisionDto,
  actorRole?: Role,
) {
  const isAssignedApprover = request.approverId === actorId;
  if (!isAssignedApprover && !isPrivileged(actorRole)) {
    throw new ForbiddenError("Only the assigned manager or an HR Admin/Super Admin can decide this request");
  }

  if (!dto.approve) {
    await prisma.learningRequest.update({
      where: { id: request.id },
      data: {
        status: LearningRequestStatus.REJECTED,
        managerApproverId: actorId,
        managerDecidedAt: new Date(),
        decidedAt: new Date(),
      },
    });
    await notify(prisma, {
      recipientId: request.employeeId,
      template: "learning.request-rejected",
      body: `Your learning reimbursement request for "${request.courseName}" was rejected.${dto.comment ? ` Comment: "${dto.comment}"` : ""}`,
      data: { comment: dto.comment },
    });
    return { status: LearningRequestStatus.REJECTED };
  }

  await prisma.learningRequest.update({
    where: { id: request.id },
    data: {
      status: LearningRequestStatus.PENDING_SUPER_ADMIN,
      managerApproverId: actorId,
      managerDecidedAt: new Date(),
    },
  });

  // Final sign-off audience only — the employee is notified solely at the
  // final outcome, not at this manager-to-final handoff.
  const privilegedIds = await listPrivilegedIds(prisma);
  await Promise.all(
    privilegedIds.map((id) =>
      notify(prisma, {
        recipientId: id,
        template: "learning.request-manager-approved",
        body: `The manager approved a ₹${request.cost} learning reimbursement request for "${request.courseName}". It now awaits your final sign-off.`,
        data: { requestId: request.id },
      }),
    ),
  );

  return { status: LearningRequestStatus.PENDING_SUPER_ADMIN };
}

interface FinalStageRequest {
  id: string;
  employeeId: string;
  courseName: string;
}

async function decideFinalStage(
  prisma: PrismaClient,
  request: FinalStageRequest,
  actorId: string,
  dto: LearningDecisionDto,
  actorRole?: Role,
) {
  if (actorRole !== "SUPER_ADMIN") {
    throw new ForbiddenError("Only a Super Admin can give final approval on this request");
  }

  await prisma.learningRequest.update({
    where: { id: request.id },
    data: dto.approve
      ? { status: LearningRequestStatus.APPROVED, finalApproverId: actorId, decidedAt: new Date() }
      : { status: LearningRequestStatus.REJECTED, finalApproverId: actorId, decidedAt: new Date() },
  });

  await notify(prisma, {
    recipientId: request.employeeId,
    template: dto.approve ? "learning.request-approved" : "learning.request-rejected",
    body: dto.approve
      ? `Your learning reimbursement request for "${request.courseName}" was approved. You can now start the course.`
      : `Your learning reimbursement request for "${request.courseName}" was rejected.${dto.comment ? ` Comment: "${dto.comment}"` : ""}`,
    data: { comment: dto.comment },
  });

  return { status: dto.approve ? LearningRequestStatus.APPROVED : LearningRequestStatus.REJECTED };
}

export async function decide(
  prisma: PrismaClient,
  requestId: string,
  actorId: string,
  dto: LearningDecisionDto,
  actorRole?: Role,
) {
  const request = await prisma.learningRequest.findUnique({ where: { id: requestId } });
  if (!request) throw new NotFoundError("Learning request not found");

  if (request.status === LearningRequestStatus.PENDING_MANAGER) {
    return decideManagerStage(prisma, request, actorId, dto, actorRole);
  }
  if (request.status === LearningRequestStatus.PENDING_SUPER_ADMIN) {
    return decideFinalStage(prisma, request, actorId, dto, actorRole);
  }
  throw new BadRequestError("This request was already decided");
}

export async function submitCertificate(
  prisma: PrismaClient,
  requestId: string,
  actorId: string,
  certificateRef: string,
) {
  const request = await prisma.learningRequest.findUnique({ where: { id: requestId } });
  if (!request) throw new NotFoundError("Learning request not found");
  if (request.employeeId !== actorId) {
    throw new ForbiddenError("This is not your learning request");
  }
  if (request.status !== LearningRequestStatus.APPROVED) {
    throw new BadRequestError("A completion certificate can only be submitted for an approved request");
  }

  const updated = await prisma.learningRequest.update({
    where: { id: requestId },
    data: { status: LearningRequestStatus.COMPLETED, certificateRef, completedAt: new Date() },
  });

  const privilegedIds = await listPrivilegedIds(prisma);
  await Promise.all(
    privilegedIds.map((id) =>
      notify(prisma, {
        recipientId: id,
        template: "learning.certificate-submitted",
        body: `A completion certificate was submitted for "${request.courseName}" — reimbursement is now pending.`,
        data: { requestId },
      }),
    ),
  );

  return updated;
}

export async function markReimbursed(prisma: PrismaClient, requestId: string, actorId: string) {
  const request = await prisma.learningRequest.findUnique({ where: { id: requestId } });
  if (!request) throw new NotFoundError("Learning request not found");
  if (request.status !== LearningRequestStatus.COMPLETED) {
    throw new BadRequestError("Only a completed request (certificate submitted) can be marked reimbursed");
  }

  const updated = await prisma.learningRequest.update({
    where: { id: requestId },
    data: { status: LearningRequestStatus.REIMBURSED, reimbursedBy: actorId, reimbursedAt: new Date() },
  });

  await notify(prisma, {
    recipientId: request.employeeId,
    template: "learning.reimbursed",
    body: `Your reimbursement for "${request.courseName}" has been processed.`,
  });

  return updated;
}

export async function listMine(prisma: PrismaClient, employeeId: string) {
  const requests = await prisma.learningRequest.findMany({
    where: { employeeId },
    orderBy: { createdAt: "desc" },
  });
  return withApproverNames(prisma, requests);
}

export async function listPendingForApprover(prisma: PrismaClient, approverId: string) {
  const requests = await prisma.learningRequest.findMany({
    where: { approverId, status: LearningRequestStatus.PENDING_MANAGER },
    include: { employee: true },
    orderBy: { createdAt: "desc" },
  });
  return withApproverNames(prisma, requests.map((r) => stripPasswordHash(r)));
}

export async function listPendingManagerStageForVisibility(prisma: PrismaClient) {
  const requests = await prisma.learningRequest.findMany({
    where: { status: LearningRequestStatus.PENDING_MANAGER },
    include: { employee: true },
    orderBy: { createdAt: "desc" },
  });
  return withApproverNames(prisma, requests.map((r) => stripPasswordHash(r)));
}

export async function listPendingFinalApproval(prisma: PrismaClient) {
  const requests = await prisma.learningRequest.findMany({
    where: { status: LearningRequestStatus.PENDING_SUPER_ADMIN },
    include: { employee: true },
    orderBy: { createdAt: "desc" },
  });
  return withApproverNames(prisma, requests.map((r) => stripPasswordHash(r)));
}

export async function listAll(prisma: PrismaClient, status?: LearningRequestStatus) {
  const requests = await prisma.learningRequest.findMany({
    where: status ? { status } : undefined,
    include: { employee: true },
    orderBy: { createdAt: "desc" },
  });
  return withApproverNames(prisma, requests.map((r) => stripPasswordHash(r)));
}
