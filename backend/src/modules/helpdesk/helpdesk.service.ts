import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  Role,
  Ticket,
  TicketCategory,
  TicketPriority,
  TicketStatus,
} from '@prisma/client';
import { PrismaService } from '../../shared/database/prisma.service';
import { DefaultCompanyService } from '../../shared/database/default-company.service';
import { NotificationService } from '../../shared/notifications/notification.service';
import { CreateTicketDto } from './dto/create-ticket.dto';
import { AddMessageDto } from './dto/add-message.dto';
import { UpdateStatusDto } from './dto/update-status.dto';
import { AssignTicketDto } from './dto/assign-ticket.dto';
import { ListTicketsQueryDto } from './dto/list-tickets-query.dto';
import { CreateFaqDto } from './dto/create-faq.dto';
import { SearchFaqQueryDto } from './dto/search-faq-query.dto';
import { UpsertSlaPolicyDto } from './dto/upsert-sla-policy.dto';

// Section 7.11 Key Features: "SLA timers per category/priority" — the real,
// HR Admin-configurable values live in TicketSlaPolicy; this is only the
// built-in fallback when no policy row exists yet for a category/priority
// pair, so the system works out of the box before HR configures anything
// (same shape as OnboardingChecklistTemplate's department-fallback lookup).
const DEFAULT_SLA_HOURS: Record<TicketPriority, number> = {
  LOW: 72,
  MEDIUM: 48,
  HIGH: 24,
  URGENT: 8,
};

// Section 7.11 Business Rule: "Employees can reopen a closed ticket within
// a configurable window (e.g., 5 days)."
const REOPEN_WINDOW_DAYS = 5;

// Section 7.11 Notifications & Triggers: "SLA at 80% elapsed ... escalation".
const SLA_WARNING_THRESHOLD = 0.8;

// Section 7.11 Workflow's linear pipeline, plus the reopen branch back into
// it. Any transition not listed here is rejected server-side regardless of
// what the UI shows.
const ALLOWED_TRANSITIONS: Record<TicketStatus, TicketStatus[]> = {
  OPEN: [TicketStatus.IN_PROGRESS],
  IN_PROGRESS: [TicketStatus.RESOLVED],
  RESOLVED: [TicketStatus.CLOSED],
  CLOSED: [TicketStatus.REOPENED],
  REOPENED: [TicketStatus.IN_PROGRESS],
};

function isPrivileged(role?: Role): boolean {
  return role === Role.HR_ADMIN || role === Role.SUPER_ADMIN;
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

@Injectable()
export class HelpdeskService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly defaultCompany: DefaultCompanyService,
    private readonly notifications: NotificationService,
  ) {}

  private async findSlaPolicy(
    category: TicketCategory,
    priority: TicketPriority,
  ) {
    const companyId = await this.defaultCompany.getOrCreate();
    return this.prisma.ticketSlaPolicy.findUnique({
      where: { companyId_category_priority: { companyId, category, priority } },
    });
  }

  // Section 7.11 Workflow: "raises ticket ... auto-routed to category
  // queue." Auto-routing here means resolving the category/priority's SLA
  // policy for its due date and, if one is configured, its designated
  // agent — otherwise the ticket sits unassigned in the category's queue.
  async createTicket(dto: CreateTicketDto, actorId: string) {
    const priority = dto.priority ?? TicketPriority.MEDIUM;
    const policy = await this.findSlaPolicy(dto.category, priority);
    const slaHours = policy?.slaHours ?? DEFAULT_SLA_HOURS[priority];
    const now = new Date();

    const ticket = await this.prisma.ticket.create({
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

    await this.notifications.send({
      recipientId: policy?.agentId ?? 'hr-admin',
      template: 'helpdesk.ticket-created',
      body: `New ${ticket.category} ticket raised: "${ticket.subject}"`,
      data: { ticketId: ticket.id, category: ticket.category },
    });

    return ticket;
  }

  // Section 6 Access Control: an Employee/Manager may only see their own
  // tickets; HR Admin/Super Admin (the agent pool) see everything and can
  // filter. There is no team-wide manager view for Helpdesk in the PRD, so
  // Manager is scoped exactly like Employee here.
  async listTickets(
    query: ListTicketsQueryDto,
    actorId: string,
    actorRole?: Role,
  ) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;

    const where: Prisma.TicketWhereInput = isPrivileged(actorRole)
      ? {
          ...(query.status && { status: query.status }),
          ...(query.category && { category: query.category }),
          ...(query.priority && { priority: query.priority }),
          ...(query.assignedAgentId && {
            assignedAgentId: query.assignedAgentId,
          }),
        }
      : { employeeId: actorId };

    const [items, total] = await Promise.all([
      this.prisma.ticket.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.ticket.count({ where }),
    ]);

    return { items, total, page, pageSize };
  }

  private assertCanView(
    ticket: Ticket,
    actorId: string,
    actorRole?: Role,
  ): void {
    if (isPrivileged(actorRole)) return;
    if (ticket.employeeId === actorId) return;
    if (ticket.assignedAgentId === actorId) return;
    throw new ForbiddenException('Not authorized to view this ticket');
  }

  async getTicket(id: string, actorId: string, actorRole?: Role) {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id },
      include: { messages: { orderBy: { createdAt: 'asc' } } },
    });
    if (!ticket) throw new NotFoundException('Ticket not found');
    this.assertCanView(ticket, actorId, actorRole);

    // Key Features: "internal-only agent notes" — never surfaced to the
    // employee who isn't also privileged or the assigned agent.
    const canSeeInternalNotes =
      isPrivileged(actorRole) || ticket.assignedAgentId === actorId;
    const messages = canSeeInternalNotes
      ? ticket.messages
      : ticket.messages.filter((m) => !m.isInternalNote);

    return { ...ticket, messages };
  }

  async addMessage(
    id: string,
    dto: AddMessageDto,
    actorId: string,
    actorRole?: Role,
  ) {
    const ticket = await this.prisma.ticket.findUnique({ where: { id } });
    if (!ticket) throw new NotFoundException('Ticket not found');
    this.assertCanView(ticket, actorId, actorRole);

    const isAgentOrHr =
      isPrivileged(actorRole) || ticket.assignedAgentId === actorId;
    const message = await this.prisma.ticketMessage.create({
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
      const recipientId = isAgentOrHr
        ? ticket.employeeId
        : (ticket.assignedAgentId ?? 'hr-admin');
      await this.notifications.send({
        recipientId,
        template: 'helpdesk.message-added',
        body: `New reply on ticket "${ticket.subject}": "${dto.body}"`,
        data: { ticketId: id },
      });
    }

    return message;
  }

  // Section 7.11 Workflow: "Agent picks up" — assignment is HR Admin/Super
  // Admin only (enforced at the controller with @Roles); this also
  // validates the target is actually part of the agent pool, since the
  // Role enum has no dedicated "Support Agent" role to check against.
  async assignTicket(id: string, dto: AssignTicketDto, actorId: string) {
    const ticket = await this.prisma.ticket.findUnique({ where: { id } });
    if (!ticket) throw new NotFoundException('Ticket not found');
    if (
      ticket.status === TicketStatus.RESOLVED ||
      ticket.status === TicketStatus.CLOSED
    ) {
      throw new BadRequestException(
        `A ${ticket.status} ticket cannot be assigned`,
      );
    }

    const agent = await this.prisma.employee.findUnique({
      where: { id: dto.agentId },
    });
    if (!agent) throw new NotFoundException('Agent not found');
    if (!isPrivileged(agent.role)) {
      throw new BadRequestException(
        'Tickets can only be assigned to an HR Admin/Super Admin acting as a support agent',
      );
    }

    const updated = await this.prisma.ticket.update({
      where: { id },
      data: {
        assignedAgentId: dto.agentId,
        status:
          ticket.status === TicketStatus.OPEN ||
          ticket.status === TicketStatus.REOPENED
            ? TicketStatus.IN_PROGRESS
            : ticket.status,
      },
    });

    await this.prisma.ticketMessage.create({
      data: {
        ticketId: id,
        senderId: actorId,
        body: `Ticket assigned to agent ${dto.agentId}`,
        isInternalNote: true,
      },
    });

    await this.notifications.send({
      recipientId: dto.agentId,
      template: 'helpdesk.ticket-assigned',
      body: `Ticket "${ticket.subject}" has been assigned to you.`,
      data: { ticketId: id },
    });

    return updated;
  }

  // Section 7.11 Business Rules & Workflow — every transition here is
  // validated against ALLOWED_TRANSITIONS plus actor/ownership rules; none
  // of this is UI-only, exactly per Section 7.11's acceptance criteria.
  async updateStatus(
    id: string,
    dto: UpdateStatusDto,
    actorId: string,
    actorRole?: Role,
  ) {
    const ticket = await this.prisma.ticket.findUnique({ where: { id } });
    if (!ticket) throw new NotFoundException('Ticket not found');

    const allowed = ALLOWED_TRANSITIONS[ticket.status] ?? [];
    if (!allowed.includes(dto.status)) {
      throw new BadRequestException(
        `Invalid status transition from ${ticket.status} to ${dto.status}`,
      );
    }

    const isOwner = ticket.employeeId === actorId;
    const isAssignedAgent = ticket.assignedAgentId === actorId;
    const privileged = isPrivileged(actorRole);

    const data: Prisma.TicketUpdateInput = { status: dto.status };
    let notifyRecipientId: string | undefined;
    let notifyTemplate: string | undefined;
    let notifyBody: string | undefined;

    switch (dto.status) {
      case TicketStatus.IN_PROGRESS: {
        if (!privileged && !isAssignedAgent) {
          throw new ForbiddenException(
            'Only an assigned agent or HR Admin can pick up this ticket',
          );
        }
        if (!ticket.assignedAgentId && privileged) {
          data.assignedAgent = { connect: { id: actorId } };
        }
        break;
      }
      case TicketStatus.RESOLVED: {
        if (!privileged && !isAssignedAgent) {
          throw new ForbiddenException(
            'Only an assigned agent or HR Admin can resolve this ticket',
          );
        }
        data.resolvedAt = new Date();
        if (dto.resolutionNote) data.resolutionNote = dto.resolutionNote;
        notifyRecipientId = ticket.employeeId;
        notifyTemplate = 'helpdesk.ticket-resolved';
        notifyBody = `Your ticket "${ticket.subject}" has been resolved.${dto.resolutionNote ? ` Comment: "${dto.resolutionNote}"` : ''}`;
        break;
      }
      case TicketStatus.CLOSED: {
        if (!privileged && !isAssignedAgent && !isOwner) {
          throw new ForbiddenException('Not authorized to close this ticket');
        }
        // Business Rule: "A ticket cannot be closed without a resolution note."
        if (!dto.resolutionNote && !ticket.resolutionNote) {
          throw new BadRequestException(
            'A ticket cannot be closed without a resolution note',
          );
        }
        data.resolutionNote = dto.resolutionNote ?? ticket.resolutionNote;
        data.closedAt = new Date();
        if (dto.csatRating !== undefined) data.csatRating = dto.csatRating;
        break;
      }
      case TicketStatus.REOPENED: {
        if (!privileged && !isOwner) {
          throw new ForbiddenException(
            'Only the employee who raised this ticket can reopen it',
          );
        }
        if (
          !ticket.closedAt ||
          daysBetween(ticket.closedAt, new Date()) > REOPEN_WINDOW_DAYS
        ) {
          throw new BadRequestException(
            `This ticket can only be reopened within ${REOPEN_WINDOW_DAYS} days of closing`,
          );
        }
        data.reopenedAt = new Date();
        notifyRecipientId = ticket.assignedAgentId ?? 'hr-admin';
        notifyTemplate = 'helpdesk.ticket-reopened';
        notifyBody = `Ticket "${ticket.subject}" was reopened by the employee.`;
        break;
      }
    }

    const [updated] = await this.prisma.$transaction([
      this.prisma.ticket.update({ where: { id }, data }),
      this.prisma.ticketMessage.create({
        data: {
          ticketId: id,
          senderId: actorId,
          body: `Status changed from ${ticket.status} to ${dto.status}`,
          isInternalNote: true,
        },
      }),
    ]);

    if (notifyRecipientId && notifyTemplate) {
      await this.notifications.send({
        recipientId: notifyRecipientId,
        template: notifyTemplate,
        body: notifyBody ?? `Ticket "${ticket.subject}" status changed to ${dto.status}.`,
        data: { ticketId: id },
      });
    }

    return updated;
  }

  // Section 7.11 Notifications & Triggers: "SLA at 80% elapsed / breached →
  // agent + escalation contact." Marks each timestamp exactly once so a
  // re-run of the cron doesn't re-notify; the cron caller sends the actual
  // notifications from what's returned here (mirrors
  // AttendanceRemindersService/AttendanceService.listPendingEscalations()).
  async runSlaSweep(): Promise<{
    warnings: Array<{ ticket: Ticket; escalationContactId: string }>;
    breaches: Array<{ ticket: Ticket; escalationContactId: string }>;
  }> {
    const now = new Date();
    const openTickets = await this.prisma.ticket.findMany({
      where: {
        status: { notIn: [TicketStatus.RESOLVED, TicketStatus.CLOSED] },
        slaDueAt: { not: null },
      },
    });

    const warnings: Array<{ ticket: Ticket; escalationContactId: string }> = [];
    const breaches: Array<{ ticket: Ticket; escalationContactId: string }> = [];

    for (const ticket of openTickets) {
      if (!ticket.slaDueAt) continue;
      const totalMs = ticket.slaDueAt.getTime() - ticket.createdAt.getTime();
      const warnAt = new Date(
        ticket.createdAt.getTime() + totalMs * SLA_WARNING_THRESHOLD,
      );
      const policy = await this.findSlaPolicy(ticket.category, ticket.priority);
      const escalationContactId =
        policy?.agentId ?? ticket.assignedAgentId ?? 'hr-admin';

      if (now >= ticket.slaDueAt && !ticket.slaBreachedAt) {
        const updated = await this.prisma.ticket.update({
          where: { id: ticket.id },
          data: { slaBreachedAt: now },
        });
        breaches.push({ ticket: updated, escalationContactId });
      } else if (now >= warnAt && !ticket.slaWarningNotifiedAt) {
        const updated = await this.prisma.ticket.update({
          where: { id: ticket.id },
          data: { slaWarningNotifiedAt: now },
        });
        warnings.push({ ticket: updated, escalationContactId });
      }
    }

    return { warnings, breaches };
  }

  async searchFaq(query: SearchFaqQueryDto) {
    return this.prisma.faqEntry.findMany({
      where: {
        isActive: true,
        ...(query.category && { category: query.category }),
        ...(query.q && {
          OR: [
            { question: { contains: query.q, mode: 'insensitive' } },
            { answer: { contains: query.q, mode: 'insensitive' } },
          ],
        }),
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createFaq(dto: CreateFaqDto) {
    const companyId = await this.defaultCompany.getOrCreate();
    return this.prisma.faqEntry.create({
      data: {
        companyId,
        category: dto.category,
        question: dto.question,
        answer: dto.answer,
      },
    });
  }

  async upsertSlaPolicy(dto: UpsertSlaPolicyDto) {
    const companyId = await this.defaultCompany.getOrCreate();
    return this.prisma.ticketSlaPolicy.upsert({
      where: {
        companyId_category_priority: {
          companyId,
          category: dto.category,
          priority: dto.priority,
        },
      },
      update: { slaHours: dto.slaHours, agentId: dto.agentId },
      create: {
        companyId,
        category: dto.category,
        priority: dto.priority,
        slaHours: dto.slaHours,
        agentId: dto.agentId,
      },
    });
  }

  async listSlaPolicies() {
    const companyId = await this.defaultCompany.getOrCreate();
    return this.prisma.ticketSlaPolicy.findMany({ where: { companyId } });
  }

  // Section 7.11 Reports & Dashboards: "Ticket volume by category/agent/
  // month," "SLA compliance %," "Top recurring ticket topics" — categories
  // stand in for "topics" since there's no separate free-text topic-
  // clustering entity in the PRD's data model.
  async getDashboardSummary() {
    const tickets = await this.prisma.ticket.findMany();

    const volumeByCategory: Record<string, number> = {};
    const volumeByAgent: Record<string, number> = {};
    const volumeByMonth: Record<string, number> = {};
    let terminalCount = 0;
    let breachedCount = 0;

    for (const t of tickets) {
      volumeByCategory[t.category] = (volumeByCategory[t.category] ?? 0) + 1;
      if (t.assignedAgentId) {
        volumeByAgent[t.assignedAgentId] =
          (volumeByAgent[t.assignedAgentId] ?? 0) + 1;
      }
      const monthKey = `${t.createdAt.getUTCFullYear()}-${String(t.createdAt.getUTCMonth() + 1).padStart(2, '0')}`;
      volumeByMonth[monthKey] = (volumeByMonth[monthKey] ?? 0) + 1;

      if (
        t.status === TicketStatus.RESOLVED ||
        t.status === TicketStatus.CLOSED
      ) {
        terminalCount++;
        if (t.slaBreachedAt) breachedCount++;
      }
    }

    const slaCompliancePercent =
      terminalCount === 0
        ? 100
        : Math.round(((terminalCount - breachedCount) / terminalCount) * 100);

    const topCategories = Object.entries(volumeByCategory)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([category, count]) => ({ category, count }));

    return {
      volumeByCategory,
      volumeByAgent,
      volumeByMonth,
      slaCompliancePercent,
      topCategories,
    };
  }
}
