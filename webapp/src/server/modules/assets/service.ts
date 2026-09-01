import type { PrismaClient, Role, AssetStatus } from "@prisma/client";
import { getOrCreateDefaultCompanyId } from "../../lib/default-company";
import { notify } from "../../lib/notify";
import type { EmployeeDataRequester } from "../../lib/reporting-hierarchy";
import { BadRequestError, ForbiddenError, NotFoundError } from "../../lib/errors";
import type { CreateAssetDto, CreateAssetRequestDto, IssueAssetDto, ReturnAssetDto } from "./dto";

// Decision authority (decideAssetRequest) — HR_ASSOCIATE deliberately
// excluded, unlike isHrStaff below.
function isPrivileged(role?: Role): boolean {
  return role === "HR_ADMIN" || role === "SUPER_ADMIN";
}

// General visibility (e.g. listAssetRequests' company-wide scope) — mirrors
// HR_ADMIN's access without granting decision authority.
function isHrStaff(role?: Role): boolean {
  return isPrivileged(role) || role === "HR_ASSOCIATE";
}

export async function createAsset(prisma: PrismaClient, dto: CreateAssetDto) {
  const companyId = dto.companyId ?? (await getOrCreateDefaultCompanyId(prisma));
  return prisma.asset.create({
    data: {
      companyId,
      category: dto.category,
      make: dto.make,
      model: dto.model,
      serialNumber: dto.serialNumber,
      purchaseDate: dto.purchaseDate ? new Date(dto.purchaseDate) : undefined,
      cost: dto.cost,
      warrantyExpiry: dto.warrantyExpiry ? new Date(dto.warrantyExpiry) : undefined,
    },
  });
}

export function listAssets(prisma: PrismaClient, status?: AssetStatus) {
  return prisma.asset.findMany({
    where: status ? { status } : undefined,
    orderBy: { createdAt: "desc" },
  });
}

function getActiveAssignment(prisma: PrismaClient, assetId: string) {
  return prisma.assetAssignment.findFirst({ where: { assetId, returnedAt: null } });
}

// Business Rule: asset request approval is HR Admin/Super Admin only — the
// reporting manager is never the approver and is never notified, regardless
// of who the employee reports to.
export async function createAssetRequest(prisma: PrismaClient, dto: CreateAssetRequestDto, actorId: string) {
  const employee = await prisma.employee.findUnique({ where: { id: actorId } });
  const request = await prisma.assetRequest.create({
    data: { employeeId: actorId, assetCategory: dto.assetCategory, justification: dto.justification },
  });

  if (employee) {
    const approvers = await prisma.employee.findMany({
      where: { companyId: employee.companyId, role: { in: ["HR_ADMIN", "SUPER_ADMIN"] } },
      select: { id: true },
    });
    await Promise.all(
      approvers.map((approver) =>
        notify(prisma, {
          recipientId: approver.id,
          template: "assets.request-pending-approval",
          body: `${employee.firstName} ${employee.lastName} requested a ${dto.assetCategory} asset and is awaiting your approval.`,
          data: { requestId: request.id },
        }),
      ),
    );
  }
  return request;
}

// Non-privileged callers can't trust their own employeeId query param — it's
// overridden to the caller's own id so one employee can't read another's
// asset requests. There's no approver-scoped view anymore: approval is HR
// Admin/Super Admin only, and they can already see every request.
export function listAssetRequests(prisma: PrismaClient, filter: { employeeId?: string }, requester: EmployeeDataRequester) {
  const employeeId = isHrStaff(requester.role) ? filter.employeeId : requester.userId;
  return prisma.assetRequest.findMany({
    where: { employeeId },
    orderBy: { createdAt: "desc" },
  });
}

export async function decideAssetRequest(prisma: PrismaClient, requestId: string, approve: boolean, actorId: string, actorRole?: Role) {
  if (!isPrivileged(actorRole)) {
    throw new ForbiddenError("Only HR Admin or Super Admin can decide an asset request");
  }
  const request = await prisma.assetRequest.findUnique({ where: { id: requestId } });
  if (!request) throw new NotFoundError("Asset request not found");
  if (request.status !== "PENDING") {
    throw new BadRequestError("This request was already decided");
  }

  return prisma.assetRequest.update({
    where: { id: requestId },
    data: { status: approve ? "APPROVED" : "REJECTED", decidedAt: new Date() },
  });
}

// Acceptance Criteria: "An asset cannot show two active custodians
// simultaneously" — reassigning auto-closes the prior custody record
// rather than requiring a manual return first.
export async function issueAsset(prisma: PrismaClient, assetId: string, dto: IssueAssetDto) {
  const asset = await prisma.asset.findUnique({ where: { id: assetId } });
  if (!asset) throw new NotFoundError("Asset not found");

  const existingActive = await getActiveAssignment(prisma, assetId);

  await prisma.$transaction([
    ...(existingActive
      ? [
          prisma.assetAssignment.update({
            where: { id: existingActive.id },
            data: { returnedAt: new Date(), returnCondition: "TRANSFERRED" },
          }),
        ]
      : []),
    prisma.assetAssignment.create({ data: { assetId, employeeId: dto.employeeId } }),
    prisma.asset.update({ where: { id: assetId }, data: { status: "PENDING_HANDOVER" } }),
  ]);

  await notify(prisma, {
    recipientId: dto.employeeId,
    template: "assets.issued-pending-acknowledgement",
    body: `A ${asset.category}${asset.model ? ` (${asset.model})` : ""} has been issued to you and is awaiting your acknowledgement.`,
    data: { assetId },
  });

  return prisma.assetAssignment.findFirstOrThrow({
    where: { assetId, employeeId: dto.employeeId, returnedAt: null },
    orderBy: { issuedAt: "desc" },
  });
}

// Acceptance Criteria: "Asset issue requires recorded employee
// acknowledgement" before it counts as truly Issued.
export async function acknowledgeAsset(prisma: PrismaClient, assignmentId: string, actorId: string) {
  const assignment = await prisma.assetAssignment.findUnique({ where: { id: assignmentId } });
  if (!assignment) throw new NotFoundError("Assignment not found");
  if (assignment.employeeId !== actorId) {
    throw new ForbiddenError("Only the receiving employee can acknowledge this asset");
  }
  if (assignment.returnedAt) {
    throw new BadRequestError("This assignment has already ended");
  }

  const [updatedAssignment] = await prisma.$transaction([
    prisma.assetAssignment.update({ where: { id: assignmentId }, data: { acknowledgedAt: new Date() } }),
    prisma.asset.update({ where: { id: assignment.assetId }, data: { status: "ISSUED" } }),
  ]);
  return updatedAssignment;
}

// Representative API: "POST /api/v1/assets/{id}/return — Process return" —
// keyed by the asset, not the assignment, since that's what HR/IT actually
// has in hand; resolves to whichever custody record is currently active.
export async function returnAsset(prisma: PrismaClient, assetId: string, dto: ReturnAssetDto) {
  const assignment = await getActiveAssignment(prisma, assetId);
  if (!assignment) {
    throw new BadRequestError("This asset has no active custodian to return from");
  }

  const condition = dto.condition ?? "GOOD";
  const [updatedAssignment] = await prisma.$transaction([
    prisma.assetAssignment.update({ where: { id: assignment.id }, data: { returnedAt: new Date(), returnCondition: condition } }),
    prisma.asset.update({ where: { id: assetId }, data: { status: "AVAILABLE", condition } }),
  ]);
  return updatedAssignment;
}

export function getEmployeeAssignments(prisma: PrismaClient, employeeId: string) {
  return prisma.assetAssignment.findMany({
    where: { employeeId },
    include: { asset: true },
    orderBy: { issuedAt: "desc" },
  });
}

// Consumed by the (future) Offboarding service — Business Rule:
// "Offboarding's IT Clearance step is blocked until every asset ... is
// marked returned/transferred".
export async function hasUnreturnedAssets(prisma: PrismaClient, employeeId: string): Promise<boolean> {
  const count = await prisma.assetAssignment.count({ where: { employeeId, returnedAt: null } });
  return count > 0;
}

// Consumed by the (future) Offboarding service's F&F calculation — Business
// Rule: "unreturned/damaged asset cost ... from the Asset module".
export async function getRecoverableAssetCost(prisma: PrismaClient, employeeId: string): Promise<number> {
  const assignments = await prisma.assetAssignment.findMany({
    where: { employeeId, OR: [{ returnedAt: null }, { returnCondition: "DAMAGED" }] },
    include: { asset: true },
  });
  return assignments.reduce((sum, a) => sum + (a.asset.cost ?? 0), 0);
}
