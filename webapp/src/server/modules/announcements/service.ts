import type { PrismaClient, Prisma, Role } from "@prisma/client";
import { notify } from "../../lib/notify";
import { BadRequestError, ForbiddenError, NotFoundError } from "../../lib/errors";
import type { CreateAnnouncementDto, CreateRecognitionDto } from "./dto";

// Business Rule: "Mandatory unread reminder → T+2 days."
const REMINDER_DELAY_DAYS = 2;

// No call site in this file is an approve/reject decision, so HR_ASSOCIATE
// (mirrors HR_ADMIN except for decision authority) is safely included here.
function isPrivileged(role?: Role): boolean {
  return role === "HR_ADMIN" || role === "SUPER_ADMIN" || role === "HR_ASSOCIATE";
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

// Key Feature: "Target employees by organization, department, or
// location." Resolves the actual employee set a scope maps to, at creation
// time — not re-evaluated later, so someone who transfers department
// after the fact doesn't retroactively gain/lose it.
function resolveTargets(prisma: PrismaClient, companyId: string, scope: string, departmentId?: string, locationId?: string) {
  const where: Prisma.EmployeeWhereInput = { companyId };
  if (scope === "DEPARTMENT") where.departmentId = departmentId;
  if (scope === "LOCATION") where.locationId = locationId;
  return prisma.employee.findMany({ where, select: { id: true } });
}

export async function createAnnouncement(prisma: PrismaClient, dto: CreateAnnouncementDto, actorId: string) {
  const actor = await prisma.employee.findUnique({ where: { id: actorId } });
  if (!actor) throw new NotFoundError("Employee not found");

  if (dto.scope === "DEPARTMENT" && !dto.departmentId) {
    throw new BadRequestError("departmentId is required when scope is DEPARTMENT");
  }
  if (dto.scope === "LOCATION" && !dto.locationId) {
    throw new BadRequestError("locationId is required when scope is LOCATION");
  }

  const targets = await resolveTargets(prisma, actor.companyId, dto.scope, dto.departmentId, dto.locationId);

  const announcement = await prisma.announcement.create({
    data: {
      companyId: actor.companyId,
      title: dto.title,
      body: dto.body,
      scope: dto.scope,
      departmentId: dto.scope === "DEPARTMENT" ? dto.departmentId : undefined,
      locationId: dto.scope === "LOCATION" ? dto.locationId : undefined,
      priority: dto.priority,
      isPinned: dto.isPinned ?? false,
      requiresAck: dto.requiresAck ?? false,
      createdBy: actorId,
      // Acceptance Criteria: "Mandatory announcement compliance accurately
      // reflects per-employee read status" — one Ack row per targeted
      // employee, created now so compliance-% is an exact count rather
      // than an approximation.
      ...(dto.requiresAck && { acks: { create: targets.map((t) => ({ employeeId: t.id })) } }),
    },
  });

  await Promise.all(
    targets.map((t) =>
      notify(prisma, {
        recipientId: t.id,
        template: "announcements.created",
        body: `New announcement: "${announcement.title}"`,
        data: { announcementId: announcement.id },
      }),
    ),
  );

  return announcement;
}

// Access Control / Acceptance Criteria: "Targeted announcements are
// visible only to the intended scope." HR Admin/Super Admin see
// everything in their company as a privileged override; everyone else
// only sees ORGANIZATION-wide announcements plus ones scoped to their own
// department/location.
export async function listAnnouncements(prisma: PrismaClient, actorId: string, actorRole?: Role) {
  const actor = await prisma.employee.findUnique({ where: { id: actorId } });
  if (!actor) throw new NotFoundError("Employee not found");

  const where: Prisma.AnnouncementWhereInput = { companyId: actor.companyId };
  if (!isPrivileged(actorRole)) {
    where.OR = [
      { scope: "ORGANIZATION" },
      { scope: "DEPARTMENT", departmentId: actor.departmentId },
      { scope: "LOCATION", locationId: actor.locationId },
    ];
  }

  const announcements = await prisma.announcement.findMany({
    where,
    orderBy: [{ isPinned: "desc" }, { createdAt: "desc" }],
  });

  // Not part of the core data model — purely a per-viewer convenience so
  // the UI can render "Acknowledge" vs "Acknowledged" without a second
  // round-trip per announcement.
  return attachMyAck(prisma, announcements, actorId);
}

async function attachMyAck<T extends { id: string; requiresAck: boolean }>(prisma: PrismaClient, announcements: T[], actorId: string) {
  const requireAckIds = announcements.filter((a) => a.requiresAck).map((a) => a.id);
  const myAcks = requireAckIds.length
    ? await prisma.announcementAck.findMany({ where: { employeeId: actorId, announcementId: { in: requireAckIds } } })
    : [];
  const byAnnouncementId = new Map(myAcks.map((a) => [a.announcementId, a]));

  return announcements.map((a) => ({
    ...a,
    myAck: byAnnouncementId.get(a.id) ? { acknowledgedAt: byAnnouncementId.get(a.id)!.acknowledgedAt } : null,
  }));
}

function assertVisible(
  announcement: { scope: string; departmentId: string | null; locationId: string | null },
  actor: { departmentId: string | null; locationId: string | null },
  actorRole?: Role,
): void {
  if (isPrivileged(actorRole)) return;
  if (announcement.scope === "ORGANIZATION") return;
  if (announcement.scope === "DEPARTMENT" && announcement.departmentId === actor.departmentId) return;
  if (announcement.scope === "LOCATION" && announcement.locationId === actor.locationId) return;
  throw new ForbiddenError("This announcement is outside your visibility scope");
}

export async function getAnnouncement(prisma: PrismaClient, id: string, actorId: string, actorRole?: Role) {
  const announcement = await prisma.announcement.findUnique({ where: { id } });
  if (!announcement) throw new NotFoundError("Announcement not found");

  const actor = await prisma.employee.findUnique({ where: { id: actorId } });
  if (!actor) throw new NotFoundError("Employee not found");
  assertVisible(announcement, actor, actorRole);

  const [withMyAck] = await attachMyAck(prisma, [announcement], actorId);
  return withMyAck;
}

// Ack rows only exist for employees who were actually targeted, so a
// missing row (rather than a role check) is what naturally enforces "you
// can only acknowledge an announcement aimed at you."
export async function ackAnnouncement(prisma: PrismaClient, id: string, actorId: string) {
  const ack = await prisma.announcementAck.findUnique({
    where: { announcementId_employeeId: { announcementId: id, employeeId: actorId } },
  });
  if (!ack) {
    throw new NotFoundError("This announcement was not found or does not target you");
  }
  if (ack.acknowledgedAt) return ack;

  return prisma.announcementAck.update({ where: { id: ack.id }, data: { acknowledgedAt: new Date() } });
}

// Acceptance Criteria: "Mandatory announcement compliance accurately
// reflects per-employee read status."
export async function getCompliance(prisma: PrismaClient, id: string) {
  const announcement = await prisma.announcement.findUnique({ where: { id } });
  if (!announcement) throw new NotFoundError("Announcement not found");

  const totalTargeted = await prisma.announcementAck.count({ where: { announcementId: id } });
  const acknowledged = await prisma.announcementAck.count({ where: { announcementId: id, acknowledgedAt: { not: null } } });
  const pending = totalTargeted - acknowledged;
  const compliancePercentage = totalTargeted === 0 ? 100 : Math.round((acknowledged / totalTargeted) * 100);

  return { totalTargeted, acknowledged, pending, compliancePercentage };
}

// HR Admin compliance user list — who has/hasn't acknowledged.
export async function getComplianceUsers(prisma: PrismaClient, id: string) {
  const announcement = await prisma.announcement.findUnique({ where: { id } });
  if (!announcement) throw new NotFoundError("Announcement not found");

  const acks = await prisma.announcementAck.findMany({
    where: { announcementId: id },
    include: { employee: { select: { id: true, employeeCode: true, firstName: true, lastName: true } } },
    orderBy: { employee: { firstName: "asc" } },
  });

  return acks.map((a) => ({
    employeeId: a.employee.id,
    employeeCode: a.employee.employeeCode,
    firstName: a.employee.firstName,
    lastName: a.employee.lastName,
    acknowledged: !!a.acknowledgedAt,
    acknowledgedAt: a.acknowledgedAt,
  }));
}

// Business Rule: "Mandatory unread reminder → T+2 days." Marks
// remindedAt once so a later sweep doesn't re-notify (same idempotency
// shape as the Helpdesk SLA sweep).
export async function findDueReminders(prisma: PrismaClient) {
  const cutoff = addDays(new Date(), -REMINDER_DELAY_DAYS);
  const due = await prisma.announcementAck.findMany({
    where: { acknowledgedAt: null, remindedAt: null, announcement: { createdAt: { lte: cutoff } } },
    include: { announcement: true },
  });

  const reminded: (typeof due)[number][] = [];
  for (const ack of due) {
    const updated = await prisma.announcementAck.update({ where: { id: ack.id }, data: { remindedAt: new Date() } });
    reminded.push({ ...updated, announcement: ack.announcement });
  }
  return reminded;
}

export async function createRecognition(prisma: PrismaClient, dto: CreateRecognitionDto, actorId: string) {
  if (dto.recipientId === actorId) {
    throw new BadRequestError("You cannot send recognition to yourself");
  }
  const recipient = await prisma.employee.findUnique({ where: { id: dto.recipientId } });
  if (!recipient) throw new NotFoundError("Recipient not found");

  const sender = await prisma.employee.findUnique({ where: { id: actorId } });
  const senderFullName = sender ? `${sender.firstName} ${sender.lastName}` : "A colleague";

  const recognition = await prisma.recognition.create({
    data: { senderId: actorId, recipientId: dto.recipientId, message: dto.message, category: dto.category, departmentId: dto.departmentId },
  });

  const notifyTargets = [recipient.id, recipient.reportingManagerId].filter((id): id is string => !!id);
  await Promise.all(
    notifyTargets.map((recipientId) =>
      notify(prisma, {
        recipientId,
        template: recipientId === recipient.id ? "recognition.received" : "recognition.manager-notified",
        body:
          recipientId === recipient.id
            ? `${senderFullName} recognized you: "${dto.message}"`
            : `${recipient.firstName} ${recipient.lastName} received recognition from ${senderFullName}: "${dto.message}"`,
        data: { recognitionId: recognition.id },
      }),
    ),
  );

  return recognition;
}

// Access Control: a department-restricted entry is only visible to that
// department's members (plus HR Admin/Super Admin); everything else is
// public kudos.
export async function listRecognitionFeed(prisma: PrismaClient, actorId: string, actorRole?: Role) {
  const actor = await prisma.employee.findUnique({ where: { id: actorId } });
  if (!actor) throw new NotFoundError("Employee not found");

  const where: Prisma.RecognitionWhereInput = isPrivileged(actorRole) ? {} : { OR: [{ departmentId: null }, { departmentId: actor.departmentId }] };

  return prisma.recognition.findMany({ where, orderBy: { createdAt: "desc" } });
}
