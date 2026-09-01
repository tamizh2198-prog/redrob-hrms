import type { PrismaClient, Prisma, Role, Ticket, TicketCategory, TicketPriority, TicketStatus } from "@prisma/client";
import { getOrCreateDefaultCompanyId } from "../../lib/default-company";
import { notify } from "../../lib/notify";
import { BadRequestError, ForbiddenError, NotFoundError } from "../../lib/errors";
import type {
  AddMessageDto,
  AssignTicketDto,
  CreateFaqDto,
  CreateTicketDto,
  ListTicketsQueryDto,
  SearchFaqQueryDto,
  UpdateStatusDto,
  UpsertSlaPolicyDto,
} from "./dto";

// Key Features: "SLA timers per category/priority" — the real,
// HR Admin-configurable values live in TicketSlaPolicy; this is only the
// built-in fallback when no policy row exists yet for a category/priority
// pair, so the system works out of the box before HR configures anything.
const DEFAULT_SLA_HOURS: Record<TicketPriority, number> = {
  LOW: 72,
  MEDIUM: 48,
  HIGH: 24,
  URGENT: 8,
};

// Business Rule: "Employees can reopen a closed ticket within a
// configurable window (e.g., 5 days)."
const REOPEN_WINDOW_DAYS = 5;

// Notifications & Triggers: "SLA at 80% elapsed ... escalation".
const SLA_WARNING_THRESHOLD = 0.8;

// The linear pipeline, plus the reopen branch back into it. Any transition
// not listed here is rejected server-side regardless of what the UI shows.
const ALLOWED_TRANSITIONS: Record<TicketStatus, TicketStatus[]> = {
  OPEN: ["IN_PROGRESS"],
  IN_PROGRESS: ["RESOLVED"],
  RESOLVED: ["CLOSED"],
  CLOSED: ["REOPENED"],
  REOPENED: ["IN_PROGRESS"],
};

// No call site in this file is an approval workflow (ticket status
// transitions and agent assignment are operational, not decisions on a
// request), so HR_ASSOCIATE is safely included here.
function isPrivileged(role?: Role): boolean {
  return role === "HR_ADMIN" || role === "SUPER_ADMIN" || role === "HR_ASSOCIATE";
}

function addHours(date: Date, hours: number): Date {
  const d = new Date(date);
  d.setUTCHours(d.getUTCHours() + hours);
  return d;
}

function daysBetween(from: Date, to: Date): number {
  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  return (to.getTime() - from.getTime()) / MS_PER_DAY;
}

async function findSlaPolicy(prisma: PrismaClient, category: TicketCategory, priority: TicketPriority) {
  const companyId = await getOrCreateDefaultCompanyId(prisma);
  return prisma.ticketSlaPolicy.findUnique({ where: { companyId_category_priority: { companyId, category, priority } } });
}

// Workflow: "raises ticket ... auto-routed to category queue." Auto-routing
// here means resolving the category/priority's SLA policy for its due date
// and, if one is configured, its designated agent — otherwise the ticket
// sits unassigned in the category's queue.
export async function createTicket(prisma: PrismaClient, dto: CreateTicketDto, actorId: string) {
  const priority = dto.priority ?? "MEDIUM";
  const policy = await findSlaPolicy(prisma, dto.category, priority);
  const slaHours = policy?.slaHours ?? DEFAULT_SLA_HOURS[priority];
  const now = new Date();

  const ticket = await prisma.ticket.create({
    data: {
      employeeId: actorId,
      category: dto.category,
      priority,
      subject: dto.subject,
      description: dto.description,
      assignedAgentId: policy?.agentId,
      slaDueAt: addHours(now, slaHours),
    },
  });

  await notify(prisma, {
    recipientId: policy?.agentId ?? "hr-admin",
    template: "helpdesk.ticket-created",
    body: `New ${ticket.category} ticket raised: "${ticket.subject}"`,
    data: { ticketId: ticket.id, category: ticket.category },
  });

  return ticket;
}

// Access Control: an Employee/Manager may only see their own tickets; HR
// Admin/Super Admin (the agent pool) see everything and can filter. There
// is no team-wide manager view for Helpdesk, so Manager is scoped exactly
// like Employee here.
export async function listTickets(prisma: PrismaClient, query: ListTicketsQueryDto, actorId: string, actorRole?: Role) {
  const page = query.page ?? 1;
  const pageSize = query.pageSize ?? 20;

  const where: Prisma.TicketWhereInput = isPrivileged(actorRole)
    ? {
        ...(query.status && { status: query.status }),
        ...(query.category && { category: query.category }),
        ...(query.priority && { priority: query.priority }),
        ...(query.assignedAgentId && { assignedAgentId: query.assignedAgentId }),
      }
    : { employeeId: actorId };

  const [items, total] = await Promise.all([
    prisma.ticket.findMany({ where, skip: (page - 1) * pageSize, take: pageSize, orderBy: { createdAt: "desc" } }),
    prisma.ticket.count({ where }),
  ]);

  return { items, total, page, pageSize };
}

function assertCanView(ticket: Ticket, actorId: string, actorRole?: Role): void {
  if (isPrivileged(actorRole)) return;
  if (ticket.employeeId === actorId) return;
  if (ticket.assignedAgentId === actorId) return;
  throw new ForbiddenError("Not authorized to view this ticket");
}

export async function getTicket(prisma: PrismaClient, id: string, actorId: string, actorRole?: Role) {
  const ticket = await prisma.ticket.findUnique({
    where: { id },
    include: { messages: { orderBy: { createdAt: "asc" } } },
  });
  if (!ticket) throw new NotFoundError("Ticket not found");
  assertCanView(ticket, actorId, actorRole);

  // Key Features: "internal-only agent notes" — never surfaced to the
  // employee who isn't also privileged or the assigned agent.
  const canSeeInternalNotes = isPrivileged(actorRole) || ticket.assignedAgentId === actorId;
  const messages = canSeeInternalNotes ? ticket.messages : ticket.messages.filter((m) => !m.isInternalNote);

  return { ...ticket, messages };
}

export async function addMessage(prisma: PrismaClient, id: string, dto: AddMessageDto, actorId: string, actorRole?: Role) {
  const ticket = await prisma.ticket.findUnique({ where: { id } });
  if (!ticket) throw new NotFoundError("Ticket not found");
  assertCanView(ticket, actorId, actorRole);

  const isAgentOrHr = isPrivileged(actorRole) || ticket.assignedAgentId === actorId;
  const message = await prisma.ticketMessage.create({
    data: {
      ticketId: id,
      senderId: actorId,
      body: dto.body,
      // Only an agent/HR can mark a note internal-only — never trust the
      // employee-supplied flag for their own message.
      isInternalNote: isAgentOrHr ? (dto.isInternalNote ?? false) : false,
      attachmentRef: dto.attachmentRef,
    },
  });

  if (!message.isInternalNote) {
    const recipientId = isAgentOrHr ? ticket.employeeId : (ticket.assignedAgentId ?? "hr-admin");
    await notify(prisma, {
      recipientId,
      template: "helpdesk.message-added",
      body: `New reply on ticket "${ticket.subject}": "${dto.body}"`,
      data: { ticketId: id },
    });
  }

  return message;
}

// Workflow: "Agent picks up" — assignment is HR Admin/Super Admin only
// (enforced at the route); this also validates the target is actually
// part of the agent pool, since the Role enum has no dedicated "Support
// Agent" role to check against.
export async function assignTicket(prisma: PrismaClient, id: string, dto: AssignTicketDto, actorId: string) {
  const ticket = await prisma.ticket.findUnique({ where: { id } });
  if (!ticket) throw new NotFoundError("Ticket not found");
  if (ticket.status === "RESOLVED" || ticket.status === "CLOSED") {
    throw new BadRequestError(`A ${ticket.status} ticket cannot be assigned`);
  }

  const agent = await prisma.employee.findUnique({ where: { id: dto.agentId } });
  if (!agent) throw new NotFoundError("Agent not found");
  if (!isPrivileged(agent.role)) {
    throw new BadRequestError("Tickets can only be assigned to an HR Admin/Super Admin acting as a support agent");
  }

  const updated = await prisma.ticket.update({
    where: { id },
    data: {
      assignedAgentId: dto.agentId,
      status: ticket.status === "OPEN" || ticket.status === "REOPENED" ? "IN_PROGRESS" : ticket.status,
    },
  });

  await prisma.ticketMessage.create({
    data: { ticketId: id, senderId: actorId, body: `Ticket assigned to agent ${dto.agentId}`, isInternalNote: true },
  });

  await notify(prisma, {
    recipientId: dto.agentId,
    template: "helpdesk.ticket-assigned",
    body: `Ticket "${ticket.subject}" has been assigned to you.`,
    data: { ticketId: id },
  });

  return updated;
}

// Business Rules & Workflow — every transition here is validated against
// ALLOWED_TRANSITIONS plus actor/ownership rules; none of this is UI-only.
export async function updateStatus(prisma: PrismaClient, id: string, dto: UpdateStatusDto, actorId: string, actorRole?: Role) {
  const ticket = await prisma.ticket.findUnique({ where: { id } });
  if (!ticket) throw new NotFoundError("Ticket not found");

  const allowed = ALLOWED_TRANSITIONS[ticket.status] ?? [];
  if (!allowed.includes(dto.status)) {
    throw new BadRequestError(`Invalid status transition from ${ticket.status} to ${dto.status}`);
  }

  const isOwner = ticket.employeeId === actorId;
  const isAssignedAgent = ticket.assignedAgentId === actorId;
  const privileged = isPrivileged(actorRole);

  const data: Prisma.TicketUpdateInput = { status: dto.status };
  let notifyRecipientId: string | undefined;
  let notifyTemplate: string | undefined;
  let notifyBody: string | undefined;

  switch (dto.status) {
    case "IN_PROGRESS": {
      if (!privileged && !isAssignedAgent) {
        throw new ForbiddenError("Only an assigned agent or HR Admin can pick up this ticket");
      }
      if (!ticket.assignedAgentId && privileged) {
        data.assignedAgent = { connect: { id: actorId } };
      }
      break;
    }
    case "RESOLVED": {
      if (!privileged && !isAssignedAgent) {
        throw new ForbiddenError("Only an assigned agent or HR Admin can resolve this ticket");
      }
      data.resolvedAt = new Date();
      if (dto.resolutionNote) data.resolutionNote = dto.resolutionNote;
      notifyRecipientId = ticket.employeeId;
      notifyTemplate = "helpdesk.ticket-resolved";
      notifyBody = `Your ticket "${ticket.subject}" has been resolved.${dto.resolutionNote ? ` Comment: "${dto.resolutionNote}"` : ""}`;
      break;
    }
    case "CLOSED": {
      if (!privileged && !isAssignedAgent && !isOwner) {
        throw new ForbiddenError("Not authorized to close this ticket");
      }
      // Business Rule: "A ticket cannot be closed without a resolution note."
      if (!dto.resolutionNote && !ticket.resolutionNote) {
        throw new BadRequestError("A ticket cannot be closed without a resolution note");
      }
      data.resolutionNote = dto.resolutionNote ?? ticket.resolutionNote;
      data.closedAt = new Date();
      if (dto.csatRating !== undefined) data.csatRating = dto.csatRating;
      break;
    }
    case "REOPENED": {
      if (!privileged && !isOwner) {
        throw new ForbiddenError("Only the employee who raised this ticket can reopen it");
      }
      if (!ticket.closedAt || daysBetween(ticket.closedAt, new Date()) > REOPEN_WINDOW_DAYS) {
        throw new BadRequestError(`This ticket can only be reopened within ${REOPEN_WINDOW_DAYS} days of closing`);
      }
      data.reopenedAt = new Date();
      notifyRecipientId = ticket.assignedAgentId ?? "hr-admin";
      notifyTemplate = "helpdesk.ticket-reopened";
      notifyBody = `Ticket "${ticket.subject}" was reopened by the employee.`;
      break;
    }
  }

  const [updated] = await prisma.$transaction([
    prisma.ticket.update({ where: { id }, data }),
    prisma.ticketMessage.create({
      data: { ticketId: id, senderId: actorId, body: `Status changed from ${ticket.status} to ${dto.status}`, isInternalNote: true },
    }),
  ]);

  if (notifyRecipientId && notifyTemplate) {
    await notify(prisma, {
      recipientId: notifyRecipientId,
      template: notifyTemplate,
      body: notifyBody ?? `Ticket "${ticket.subject}" status changed to ${dto.status}.`,
      data: { ticketId: id },
    });
  }

  return updated;
}

// Notifications & Triggers: "SLA at 80% elapsed / breached → agent +
// escalation contact." Marks each timestamp exactly once so a re-run of
// the cron doesn't re-notify; the cron caller sends the actual
// notifications from what's returned here.
export async function runSlaSweep(
  prisma: PrismaClient,
): Promise<{ warnings: { ticket: Ticket; escalationContactId: string }[]; breaches: { ticket: Ticket; escalationContactId: string }[] }> {
  const now = new Date();
  const openTickets = await prisma.ticket.findMany({
    where: { status: { notIn: ["RESOLVED", "CLOSED"] }, slaDueAt: { not: null } },
  });

  const warnings: { ticket: Ticket; escalationContactId: string }[] = [];
  const breaches: { ticket: Ticket; escalationContactId: string }[] = [];

  for (const ticket of openTickets) {
    if (!ticket.slaDueAt) continue;
    const totalMs = ticket.slaDueAt.getTime() - ticket.createdAt.getTime();
    const warnAt = new Date(ticket.createdAt.getTime() + totalMs * SLA_WARNING_THRESHOLD);
    const policy = await findSlaPolicy(prisma, ticket.category, ticket.priority);
    const escalationContactId = policy?.agentId ?? ticket.assignedAgentId ?? "hr-admin";

    if (now >= ticket.slaDueAt && !ticket.slaBreachedAt) {
      const updated = await prisma.ticket.update({ where: { id: ticket.id }, data: { slaBreachedAt: now } });
      breaches.push({ ticket: updated, escalationContactId });
    } else if (now >= warnAt && !ticket.slaWarningNotifiedAt) {
      const updated = await prisma.ticket.update({ where: { id: ticket.id }, data: { slaWarningNotifiedAt: now } });
      warnings.push({ ticket: updated, escalationContactId });
    }
  }

  return { warnings, breaches };
}

export function searchFaq(prisma: PrismaClient, query: SearchFaqQueryDto) {
  return prisma.faqEntry.findMany({
    where: {
      isActive: true,
      ...(query.category && { category: query.category }),
      ...(query.q && {
        OR: [
          { question: { contains: query.q, mode: "insensitive" as const } },
          { answer: { contains: query.q, mode: "insensitive" as const } },
        ],
      }),
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function createFaq(prisma: PrismaClient, dto: CreateFaqDto) {
  const companyId = await getOrCreateDefaultCompanyId(prisma);
  return prisma.faqEntry.create({ data: { companyId, category: dto.category, question: dto.question, answer: dto.answer } });
}

export async function upsertSlaPolicy(prisma: PrismaClient, dto: UpsertSlaPolicyDto) {
  const companyId = await getOrCreateDefaultCompanyId(prisma);
  return prisma.ticketSlaPolicy.upsert({
    where: { companyId_category_priority: { companyId, category: dto.category, priority: dto.priority } },
    update: { slaHours: dto.slaHours, agentId: dto.agentId },
    create: { companyId, category: dto.category, priority: dto.priority, slaHours: dto.slaHours, agentId: dto.agentId },
  });
}

export async function listSlaPolicies(prisma: PrismaClient) {
  const companyId = await getOrCreateDefaultCompanyId(prisma);
  return prisma.ticketSlaPolicy.findMany({ where: { companyId } });
}

// Reports & Dashboards: "Ticket volume by category/agent/month," "SLA
// compliance %," "Top recurring ticket topics" — categories stand in for
// "topics" since there's no separate free-text topic-clustering entity.
export async function getDashboardSummary(prisma: PrismaClient) {
  const tickets = await prisma.ticket.findMany();

  const volumeByCategory: Record<string, number> = {};
  const volumeByAgent: Record<string, number> = {};
  const volumeByMonth: Record<string, number> = {};
  let terminalCount = 0;
  let breachedCount = 0;

  for (const t of tickets) {
    volumeByCategory[t.category] = (volumeByCategory[t.category] ?? 0) + 1;
    if (t.assignedAgentId) {
      volumeByAgent[t.assignedAgentId] = (volumeByAgent[t.assignedAgentId] ?? 0) + 1;
    }
    const monthKey = `${t.createdAt.getUTCFullYear()}-${String(t.createdAt.getUTCMonth() + 1).padStart(2, "0")}`;
    volumeByMonth[monthKey] = (volumeByMonth[monthKey] ?? 0) + 1;

    if (t.status === "RESOLVED" || t.status === "CLOSED") {
      terminalCount++;
      if (t.slaBreachedAt) breachedCount++;
    }
  }

  const slaCompliancePercent = terminalCount === 0 ? 100 : Math.round(((terminalCount - breachedCount) / terminalCount) * 100);

  const topCategories = Object.entries(volumeByCategory)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([category, count]) => ({ category, count }));

  return { volumeByCategory, volumeByAgent, volumeByMonth, slaCompliancePercent, topCategories };
}
