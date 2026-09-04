import type { PrismaClient, Role } from "@prisma/client";
import { RequestCommentType, WorkMode } from "@prisma/client";
import { notify } from "../../lib/notify";
import { addSuperAdminComment, listSuperAdminComments } from "../../lib/request-comments";
import { BadRequestError, ForbiddenError, NotFoundError } from "../../lib/errors";
import type { CreateWfoWfhRequestDto, WfoWfhDecisionDto } from "./dto";

function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

// Decision authority (decideManagerStage/decideFinalStage) — HR_ASSOCIATE
// deliberately excluded, unlike isHrStaff below.
function isPrivileged(role?: Role): boolean {
  return role === "HR_ADMIN" || role === "SUPER_ADMIN";
}

// General visibility (listComments) — mirrors HR_ADMIN's access without
// granting decision authority.
function isHrStaff(role?: Role): boolean {
  return isPrivileged(role) || role === "HR_ASSOCIATE";
}

function oppositeWorkMode(mode: WorkMode): WorkMode {
  return mode === WorkMode.OFFICE ? WorkMode.WORK_FROM_HOME : WorkMode.OFFICE;
}

// Same "manager, else any HR Admin/Super Admin, else fail explicitly"
// fallback pattern used elsewhere — no silent no-approver gap.
async function findHrAdminId(prisma: PrismaClient, excludeId?: string): Promise<string | null> {
  const hrAdmin = await prisma.employee.findFirst({
    where: { role: { in: ["HR_ADMIN", "SUPER_ADMIN"] }, ...(excludeId && { id: { not: excludeId } }) },
  });
  return hrAdmin?.id ?? null;
}

async function listPrivilegedIds(prisma: PrismaClient, excludeId?: string): Promise<string[]> {
  const admins = await prisma.employee.findMany({
    where: { role: { in: ["HR_ADMIN", "SUPER_ADMIN"] }, ...(excludeId && { id: { not: excludeId } }) },
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

// approverId is a loose string, not a Prisma relation (see the schema
// comment), so it can't be resolved via `include` — this attaches a display
// name for it manually. approverId is set once at submission (the
// requester's manager, or an HR Admin fallback) and never cleared, so it
// names "whoever this request was/is routed to" for the manager stage
// throughout the request's lifecycle, which is what every view — the
// requester's own list, the manager's queues, and Super Admin/HR's
// visibility views — needs to show as "Manager".
async function attachApproverNames<T extends { approverId: string | null }>(
  prisma: PrismaClient,
  requests: T[],
): Promise<(T & { approverName: string | null })[]> {
  const approverIds = [...new Set(requests.map((r) => r.approverId).filter((id): id is string => !!id))];
  if (approverIds.length === 0) {
    return requests.map((r) => ({ ...r, approverName: null }));
  }
  const approvers = await prisma.employee.findMany({
    where: { id: { in: approverIds } },
    select: { id: true, firstName: true, lastName: true },
  });
  const nameById = new Map(approvers.map((a) => [a.id, `${a.firstName} ${a.lastName}`]));
  return requests.map((r) => ({ ...r, approverName: r.approverId ? (nameById.get(r.approverId) ?? null) : null }));
}

function rosterSwapOps(
  prisma: PrismaClient,
  request: {
    employeeId: string;
    originalDate: Date;
    requestedWorkMode: WorkMode;
    compensatoryDate: Date;
    compensatoryWorkMode: WorkMode;
  },
) {
  return [
    prisma.rosterEntry.upsert({
      where: { employeeId_date: { employeeId: request.employeeId, date: request.originalDate } },
      update: { workMode: request.requestedWorkMode },
      create: { employeeId: request.employeeId, date: request.originalDate, workMode: request.requestedWorkMode },
    }),
    prisma.rosterEntry.upsert({
      where: { employeeId_date: { employeeId: request.employeeId, date: request.compensatoryDate } },
      update: { workMode: request.compensatoryWorkMode, isWeekOff: false },
      create: {
        employeeId: request.employeeId,
        date: request.compensatoryDate,
        workMode: request.compensatoryWorkMode,
        isWeekOff: false,
      },
    }),
  ];
}

export async function submit(prisma: PrismaClient, employeeId: string, dto: CreateWfoWfhRequestDto, actorRole?: Role) {
  const originalDate = startOfDay(new Date(dto.originalDate));
  const compensatoryDate = startOfDay(new Date(dto.compensatoryDate));
  if (originalDate.getTime() === compensatoryDate.getTime()) {
    throw new BadRequestError("originalDate and compensatoryDate must be different");
  }

  const employee = await prisma.employee.findUnique({ where: { id: employeeId } });
  if (!employee) throw new NotFoundError("Employee not found");

  const existingEntry = await prisma.rosterEntry.findUnique({ where: { employeeId_date: { employeeId, date: originalDate } } });
  const currentMode = existingEntry?.workMode ?? WorkMode.OFFICE;
  if (dto.requestedWorkMode === currentMode) {
    throw new BadRequestError("Requested work mode matches the current roster for this date");
  }
  const compensatoryWorkMode = oppositeWorkMode(dto.requestedWorkMode);

  // A Super Admin's own request needs nobody's approval — apply it
  // immediately rather than routing it through a workflow they'd just have
  // to approve themselves.
  if (actorRole === "SUPER_ADMIN") {
    const [request] = await prisma.$transaction([
      prisma.wfoWfhChangeRequest.create({
        data: {
          employeeId,
          originalDate,
          requestedWorkMode: dto.requestedWorkMode,
          compensatoryDate,
          compensatoryWorkMode,
          reason: dto.reason,
          status: "APPROVED",
          finalApproverId: employeeId,
          decidedAt: new Date(),
        },
      }),
      ...rosterSwapOps(prisma, { employeeId, originalDate, requestedWorkMode: dto.requestedWorkMode, compensatoryDate, compensatoryWorkMode }),
    ]);
    return request;
  }

  let approverId = employee.reportingManagerId;
  if (!approverId) {
    approverId = await findHrAdminId(prisma, employeeId);
    if (!approverId) {
      throw new BadRequestError("No approver is configured for this employee — assign a reporting manager or an HR Admin first");
    }
  }

  const request = await prisma.wfoWfhChangeRequest.create({
    data: { employeeId, originalDate, requestedWorkMode: dto.requestedWorkMode, compensatoryDate, compensatoryWorkMode, reason: dto.reason, approverId },
  });

  const dateLabel = originalDate.toISOString().slice(0, 10);

  await notify(prisma, {
    recipientId: approverId,
    template: "wfo-wfh-request.submitted",
    body: `${employee.firstName} ${employee.lastName} requested to switch to ${dto.requestedWorkMode} on ${dateLabel} and is awaiting your approval.`,
    data: { requestId: request.id },
  });

  // Super Admin and HR Admin see the request from the moment it's raised
  // (visibility), even though it isn't theirs to act on until the manager
  // has approved it (actionability).
  const privilegedIds = (await listPrivilegedIds(prisma)).filter((id) => id !== approverId);
  await Promise.all(
    privilegedIds.map((id) =>
      notify(prisma, {
        recipientId: id,
        template: "wfo-wfh-request.submitted-fyi",
        body: `${employee.firstName} ${employee.lastName} requested to switch to ${dto.requestedWorkMode} on ${dateLabel}. It is awaiting manager approval first — you'll be able to act on it once that happens.`,
        data: { requestId: request.id },
      }),
    ),
  );

  return request;
}

export async function decide(prisma: PrismaClient, requestId: string, actorId: string, dto: WfoWfhDecisionDto, actorRole?: Role) {
  const request = await prisma.wfoWfhChangeRequest.findUnique({ where: { id: requestId } });
  if (!request) throw new NotFoundError("WFO/WFH request not found");

  if (request.status === "PENDING_MANAGER") {
    return decideManagerStage(prisma, request, actorId, dto);
  }
  if (request.status === "PENDING_FINAL_APPROVAL") {
    return decideFinalStage(prisma, request, actorId, dto, actorRole);
  }
  throw new BadRequestError("This request was already decided");
}

async function decideManagerStage(
  prisma: PrismaClient,
  request: { id: string; employeeId: string; approverId: string | null; requestedWorkMode: WorkMode; originalDate: Date },
  actorId: string,
  dto: WfoWfhDecisionDto,
) {
  // Manager-stage sign-off is scoped to the employee's actual manager
  // (approverId) — HR Admin/Super Admin get visibility into these requests
  // (see the pending-manager-stage list) but cannot decide one themselves
  // unless they are literally the assigned approver (either the real
  // reportingManager, or the HR-admin fallback submit() uses when the
  // employee has no manager on file).
  const isAssignedApprover = request.approverId === actorId;
  if (!isAssignedApprover) {
    throw new ForbiddenError("Only the employee's assigned manager can decide this request");
  }

  if (!dto.approve) {
    await prisma.wfoWfhChangeRequest.update({
      where: { id: request.id },
      data: { status: "REJECTED", managerApproverId: actorId, managerDecidedAt: new Date(), decidedAt: new Date() },
    });
    await notify(prisma, {
      recipientId: request.employeeId,
      template: "wfo-wfh-request.rejected",
      body: `Your request to switch to ${request.requestedWorkMode} on ${request.originalDate.toISOString().slice(0, 10)} was rejected.${dto.comment ? ` Comment: "${dto.comment}"` : ""}`,
      data: { comment: dto.comment },
    });
    return { status: "REJECTED" };
  }

  await prisma.wfoWfhChangeRequest.update({
    where: { id: request.id },
    data: { status: "PENDING_FINAL_APPROVAL", managerApproverId: actorId, managerDecidedAt: new Date() },
  });

  // Final sign-off audience only — the requesting employee is notified
  // solely at the final outcome, not at this manager-to-final handoff.
  const privilegedIds = await listPrivilegedIds(prisma);
  const dateLabel = request.originalDate.toISOString().slice(0, 10);
  await Promise.all(
    privilegedIds.map((id) =>
      notify(prisma, {
        recipientId: id,
        template: "wfo-wfh-request.manager-approved",
        body: `The manager approved switching to ${request.requestedWorkMode} on ${dateLabel} for this employee. It now awaits your final sign-off (Super Admin or HR Admin).`,
        data: { requestId: request.id },
      }),
    ),
  );

  return { status: "PENDING_FINAL_APPROVAL" };
}

async function decideFinalStage(
  prisma: PrismaClient,
  request: { id: string; employeeId: string; requestedWorkMode: WorkMode; originalDate: Date; compensatoryDate: Date; compensatoryWorkMode: WorkMode },
  actorId: string,
  dto: WfoWfhDecisionDto,
  actorRole?: Role,
) {
  if (!isPrivileged(actorRole)) {
    throw new ForbiddenError("Only a Super Admin or HR Admin can give final approval on this request");
  }

  if (dto.approve) {
    await prisma.$transaction([
      ...rosterSwapOps(prisma, request),
      prisma.wfoWfhChangeRequest.update({ where: { id: request.id }, data: { status: "APPROVED", finalApproverId: actorId, decidedAt: new Date() } }),
    ]);
  } else {
    await prisma.wfoWfhChangeRequest.update({ where: { id: request.id }, data: { status: "REJECTED", finalApproverId: actorId, decidedAt: new Date() } });
  }

  await notify(prisma, {
    recipientId: request.employeeId,
    template: dto.approve ? "wfo-wfh-request.approved" : "wfo-wfh-request.rejected",
    body: `Your request to switch to ${request.requestedWorkMode} on ${request.originalDate.toISOString().slice(0, 10)} was ${dto.approve ? "approved" : "rejected"}.${dto.comment ? ` Comment: "${dto.comment}"` : ""}`,
    data: { comment: dto.comment },
  });

  return { status: dto.approve ? "APPROVED" : "REJECTED" };
}

export async function listMine(prisma: PrismaClient, employeeId: string) {
  const requests = await prisma.wfoWfhChangeRequest.findMany({ where: { employeeId }, orderBy: { createdAt: "desc" } });
  return attachApproverNames(prisma, requests);
}

export async function listPendingForApprover(prisma: PrismaClient, approverId: string) {
  const requests = await prisma.wfoWfhChangeRequest.findMany({
    where: { approverId, status: "PENDING_MANAGER" },
    include: { employee: true },
    orderBy: { createdAt: "desc" },
  });
  return attachApproverNames(prisma, requests.map((r) => stripPasswordHash(r)));
}

// Manager-stage requests aren't actionable by Super Admin/HR Admin yet, but
// they were promised visibility into them at submission time.
export async function listPendingManagerStageForVisibility(prisma: PrismaClient) {
  const requests = await prisma.wfoWfhChangeRequest.findMany({
    where: { status: "PENDING_MANAGER" },
    include: { employee: true },
    orderBy: { createdAt: "desc" },
  });
  return attachApproverNames(prisma, requests.map((r) => stripPasswordHash(r)));
}

export async function listPendingFinalApproval(prisma: PrismaClient) {
  const requests = await prisma.wfoWfhChangeRequest.findMany({
    where: { status: "PENDING_FINAL_APPROVAL" },
    include: { employee: true },
    orderBy: { createdAt: "desc" },
  });
  return attachApproverNames(prisma, requests.map((r) => stripPasswordHash(r)));
}

export async function listAll(prisma: PrismaClient, status?: "PENDING_MANAGER" | "PENDING_FINAL_APPROVAL" | "APPROVED" | "REJECTED") {
  const requests = await prisma.wfoWfhChangeRequest.findMany({
    where: { status },
    include: { employee: true },
    orderBy: { createdAt: "desc" },
  });
  return attachApproverNames(prisma, requests.map((r) => stripPasswordHash(r)));
}

export async function addComment(prisma: PrismaClient, requestId: string, authorId: string, body: string) {
  const request = await prisma.wfoWfhChangeRequest.findUnique({ where: { id: requestId } });
  if (!request) throw new NotFoundError("WFO/WFH request not found");

  const comment = await addSuperAdminComment(prisma, { requestType: RequestCommentType.WFO_WFH_CHANGE, requestId, authorId, body });

  if (request.approverId) {
    await notify(prisma, {
      recipientId: request.approverId,
      template: "wfo-wfh-request.comment-added",
      body: `A new comment was added to the WFO/WFH change request for ${request.originalDate.toISOString().slice(0, 10)}: "${body}"`,
      data: { requestId },
    });
  }

  return comment;
}

export async function listComments(prisma: PrismaClient, requestId: string, actorId: string, actorRole?: Role) {
  const request = await prisma.wfoWfhChangeRequest.findUnique({ where: { id: requestId } });
  if (!request) throw new NotFoundError("WFO/WFH request not found");
  if (request.approverId !== actorId && !isHrStaff(actorRole)) {
    throw new ForbiddenError("Only the assigned approver or an HR Admin/Super Admin can view these comments");
  }
  return listSuperAdminComments(prisma, RequestCommentType.WFO_WFH_CHANGE, requestId);
}
