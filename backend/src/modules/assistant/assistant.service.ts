import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  LeaveApplicationStatus,
  Prisma,
  ReviewStatus,
  Role,
} from '@prisma/client';
import { PrismaService } from '../../shared/database/prisma.service';
import { getReportingHierarchyIds } from '../../shared/employee/reporting-hierarchy.util';
import { LeaveService } from '../leave/leave.service';
import { HolidayService } from '../holiday/holiday.service';
import { HelpdeskService } from '../helpdesk/helpdesk.service';
import {
  AssistantLlmGateway,
  AssistantUnavailableError,
  type LlmResponse,
  type LlmToolDef,
} from './assistant-llm.gateway';
import { SendMessageDto } from './dto/send-message.dto';
import { ConfirmActionDto } from './dto/confirm-action.dto';
import { UploadPolicyDocumentDto } from './dto/upload-policy-document.dto';

interface GroundedSource {
  docId: string;
  title: string;
  excerpt: string;
}

interface ProposedAction {
  type: string;
  input: Record<string, unknown>;
}

// Section 7.14 Key Feature: employee-facing actions. Read tools execute
// immediately (RBAC-scoped to the caller); write tools only ever get
// DRAFTED here — see WRITE_TOOLS / confirmAction().
const TOOLS: LlmToolDef[] = [
  {
    name: 'check_leave_balance',
    description:
      "Check the requesting employee's own leave balances for the current year.",
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'apply_leave',
    description:
      'Draft a leave application for the requesting employee. Does NOT submit it — the user must separately confirm.',
    input_schema: {
      type: 'object',
      properties: {
        leaveTypeName: {
          type: 'string',
          description: 'e.g. "Earned Leave", "Sick Leave"',
        },
        startDate: { type: 'string', description: 'YYYY-MM-DD' },
        endDate: { type: 'string', description: 'YYYY-MM-DD' },
        reason: { type: 'string' },
      },
      required: ['leaveTypeName', 'startDate', 'endDate'],
    },
  },
  {
    name: 'raise_ticket',
    description:
      'Draft a helpdesk ticket for the requesting employee. Does NOT submit it — the user must separately confirm.',
    input_schema: {
      type: 'object',
      properties: {
        category: {
          type: 'string',
          enum: [
            'PAYROLL_QUERY',
            'LEAVE_ATTENDANCE_ISSUE',
            'IT_SUPPORT',
            'ADMIN_FACILITIES',
            'GENERAL_HR',
          ],
        },
        subject: { type: 'string' },
        description: { type: 'string' },
      },
      required: ['category', 'subject', 'description'],
    },
  },
  {
    name: 'view_holiday_calendar',
    description:
      "View the requesting employee's location holiday calendar for a year.",
    input_schema: {
      type: 'object',
      properties: { year: { type: 'integer' } },
    },
  },
];

// Section 7.14 Key Feature: "Manager-facing queries" — only offered to
// Role.MANAGER callers (see sendMessage), never surfaced to Employee tokens.
const MANAGER_TOOLS: LlmToolDef[] = [
  {
    name: 'team_leave_this_week',
    description:
      "List the manager's direct and indirect reports who are on approved leave this week.",
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'pending_reviews',
    description:
      "List the manager's team members whose performance review is not yet finalized.",
    input_schema: { type: 'object', properties: {} },
  },
];

const WRITE_TOOLS = new Set(['apply_leave', 'raise_ticket']);

function startOfWeek(date: Date): Date {
  const d = new Date(date);
  const day = d.getUTCDay();
  const diff = (day + 6) % 7; // Monday-start week
  d.setUTCDate(d.getUTCDate() - diff);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

@Injectable()
export class AssistantService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: AssistantLlmGateway,
    private readonly leaveService: LeaveService,
    private readonly holidayService: HolidayService,
    private readonly helpdeskService: HelpdeskService,
  ) {}

  // Section 7.14 Workflow: "retrieves relevant policy/data (scoped to
  // user's RBAC permissions) -> drafts an answer or proposed action ->
  // user confirms (if any) -> executes through the same APIs a manual UI
  // action would use -> logged." This method covers everything up to (and
  // including) the propose step; confirmAction() covers execution.
  async sendMessage(
    actorId: string,
    role: Role | undefined,
    dto: SendMessageDto,
  ) {
    const conversation = await this.getOrCreateConversation(
      actorId,
      dto.conversationId,
    );

    await this.prisma.assistantMessage.create({
      data: {
        conversationId: conversation.id,
        role: 'USER',
        message: dto.message,
      },
    });

    const groundedSources = await this.retrieveGroundedSources(
      actorId,
      dto.message,
    );
    const tools = role === Role.MANAGER ? [...TOOLS, ...MANAGER_TOOLS] : TOOLS;
    const systemPrompt = this.buildSystemPrompt(groundedSources);

    let llmResult: LlmResponse;
    try {
      llmResult = await this.llm.complete(systemPrompt, dto.message, tools);
    } catch (err) {
      if (err instanceof AssistantUnavailableError) {
        return this.saveAssistantMessage(conversation.id, err.message, []);
      }
      throw err;
    }

    if (!llmResult.toolCall) {
      return this.saveAssistantMessage(
        conversation.id,
        llmResult.text,
        groundedSources,
      );
    }

    const { name, input } = llmResult.toolCall;

    // AC: "Assistant never executes a write action without explicit
    // confirmation" — write tools are ALWAYS drafted, never run here.
    if (WRITE_TOOLS.has(name)) {
      const message = await this.saveAssistantMessage(
        conversation.id,
        this.describeProposedAction(name, input),
        [],
        {
          type: name,
          input,
        },
      );
      return message;
    }

    const resultText = await this.executeReadTool(name, input, actorId, role);
    return this.saveAssistantMessage(
      conversation.id,
      resultText,
      groundedSources,
    );
  }

  async confirmAction(actorId: string, dto: ConfirmActionDto) {
    const message = await this.prisma.assistantMessage.findUnique({
      where: { id: dto.messageId },
      include: { conversation: true },
    });
    if (!message || !message.proposedAction) {
      throw new NotFoundException('No pending action found for this message');
    }
    if (message.conversation.employeeId !== actorId) {
      throw new ForbiddenException("You cannot confirm another user's action");
    }
    if (message.actionTaken) {
      throw new BadRequestException('This action has already been executed');
    }

    const { type, input } = message.proposedAction as unknown as ProposedAction;
    const result = await this.executeWriteTool(type, input, actorId);

    // Section 7.14 Business Rule: "tagged as 'AI-assisted' with the
    // underlying user's identity, not a generic system identity" — actorId
    // here is the real caller, passed straight through to the same
    // LeaveService/HelpdeskService methods the manual UI uses.
    return this.prisma.assistantMessage.update({
      where: { id: message.id },
      data: {
        actionTaken: JSON.parse(
          JSON.stringify({
            type,
            input,
            result,
            initiatedVia: 'AI_ASSISTANT',
            actorId,
          }),
        ) as Prisma.InputJsonValue,
      },
    });
  }

  async uploadPolicyDocument(dto: UploadPolicyDocumentDto, actorId: string) {
    const actor = await this.prisma.employee.findUnique({
      where: { id: actorId },
      select: { companyId: true },
    });
    if (!actor) throw new NotFoundException('Employee not found');

    return this.prisma.policyDocument.create({
      data: {
        companyId: actor.companyId,
        title: dto.title,
        content: dto.content,
        uploadedById: actorId,
      },
    });
  }

  listConversationMessages(actorId: string, conversationId: string) {
    return this.prisma.assistantMessage.findMany({
      where: { conversationId, conversation: { employeeId: actorId } },
      orderBy: { createdAt: 'asc' },
    });
  }

  private async getOrCreateConversation(
    actorId: string,
    conversationId?: string,
  ) {
    if (conversationId) {
      const existing = await this.prisma.assistantConversation.findUnique({
        where: { id: conversationId },
      });
      if (!existing || existing.employeeId !== actorId) {
        throw new ForbiddenException(
          'You do not have access to this conversation',
        );
      }
      return existing;
    }
    return this.prisma.assistantConversation.create({
      data: { employeeId: actorId },
    });
  }

  private async saveAssistantMessage(
    conversationId: string,
    text: string,
    groundedSources: GroundedSource[],
    proposedAction?: ProposedAction,
  ) {
    return this.prisma.assistantMessage.create({
      data: {
        conversationId,
        role: 'ASSISTANT',
        message: text,
        groundedSources: groundedSources as unknown as Prisma.InputJsonValue,
        proposedAction: proposedAction as unknown as
          Prisma.InputJsonValue | undefined,
      },
    });
  }

  // Section 7.14 Business Rule: "Policy answers must be grounded in indexed
  // company documents." No vector DB in this stack — plain keyword-overlap
  // scoring across each company's own PolicyDocument rows.
  private async retrieveGroundedSources(
    actorId: string,
    query: string,
  ): Promise<GroundedSource[]> {
    const actor = await this.prisma.employee.findUnique({
      where: { id: actorId },
      select: { companyId: true },
    });
    if (!actor) return [];

    const docs = await this.prisma.policyDocument.findMany({
      where: { companyId: actor.companyId },
    });
    const terms = query
      .toLowerCase()
      .split(/\W+/)
      .filter((t) => t.length > 2);

    return docs
      .map((doc) => ({
        doc,
        score: terms.reduce(
          (sum, t) =>
            sum +
            (doc.content.toLowerCase().includes(t) ? 1 : 0) +
            (doc.title.toLowerCase().includes(t) ? 2 : 0),
          0,
        ),
      }))
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map((s) => ({
        docId: s.doc.id,
        title: s.doc.title,
        excerpt: s.doc.content.slice(0, 800),
      }));
  }

  private buildSystemPrompt(sources: GroundedSource[]): string {
    const sourcesText = sources.length
      ? sources.map((s) => `[Source: ${s.title}]\n${s.excerpt}`).join('\n\n')
      : 'No matching policy documents were found for this question.';

    return [
      'You are the Redrob HRMS assistant. You help employees with HR policy questions and can propose (never directly execute) HR actions via tools.',
      'RULES:',
      "- Answer policy questions ONLY using the POLICY SOURCES below. If they do not contain the answer, say you don't have this information and to contact HR — never guess or invent policy.",
      "- Never claim an action has been completed. Any tool you call for a write action is only a DRAFT pending the user's explicit confirmation.",
      '- Cite which policy document you used, if any.',
      '',
      'POLICY SOURCES:',
      sourcesText,
    ].join('\n');
  }

  private describeProposedAction(
    name: string,
    input: Record<string, unknown>,
  ): string {
    const str = (v: unknown) => (typeof v === 'string' ? v : '');

    if (name === 'apply_leave') {
      const reason = str(input.reason);
      return (
        `I can draft a leave application: ${str(input.leaveTypeName)} from ${str(input.startDate)} to ${str(input.endDate)}` +
        `${reason ? ` (${reason})` : ''}. Please confirm to submit it.`
      );
    }
    if (name === 'raise_ticket') {
      return `I can raise a ${str(input.category)} helpdesk ticket titled "${str(input.subject)}". Please confirm to submit it.`;
    }
    return 'Please confirm to proceed with this action.';
  }

  private async executeReadTool(
    name: string,
    input: Record<string, unknown>,
    actorId: string,
    role: Role | undefined,
  ): Promise<string> {
    switch (name) {
      case 'check_leave_balance': {
        const year = new Date().getUTCFullYear();
        const balances = await this.leaveService.getBalances(actorId, year, {
          userId: actorId,
          role,
        });
        if (balances.length === 0)
          return 'You have no configured leave balances.';
        return balances
          .map((b) => `${b.leaveType.name}: ${b.available} day(s) available`)
          .join('\n');
      }
      case 'view_holiday_calendar': {
        const actor = await this.prisma.employee.findUnique({
          where: { id: actorId },
          select: { locationId: true },
        });
        if (!actor?.locationId) {
          return 'You do not have a location assigned, so I cannot show your holiday calendar.';
        }
        const year =
          (input.year as number | undefined) ?? new Date().getUTCFullYear();
        const holidays = await this.holidayService.listCalendar(
          actor.locationId,
          year,
        );
        if (holidays.length === 0) return `No holidays found for ${year}.`;
        return holidays
          .map((h) => `${h.date.toISOString().slice(0, 10)}: ${h.name}`)
          .join('\n');
      }
      case 'team_leave_this_week': {
        if (role !== Role.MANAGER) {
          throw new ForbiddenException('Only managers can view team leave');
        }
        const teamIds = await getReportingHierarchyIds(this.prisma, actorId);
        const start = startOfWeek(new Date());
        const end = new Date(start);
        end.setUTCDate(end.getUTCDate() + 6);

        const onLeave = await this.prisma.leaveApplication.findMany({
          where: {
            employeeId: { in: teamIds },
            status: LeaveApplicationStatus.APPROVED,
            startDate: { lte: end },
            endDate: { gte: start },
          },
          include: {
            employee: { select: { firstName: true, lastName: true } },
          },
        });
        if (onLeave.length === 0)
          return 'No one on your team is on leave this week.';
        return onLeave
          .map(
            (a) =>
              `${a.employee.firstName} ${a.employee.lastName}: ${a.startDate.toISOString().slice(0, 10)} to ${a.endDate.toISOString().slice(0, 10)}`,
          )
          .join('\n');
      }
      case 'pending_reviews': {
        if (role !== Role.MANAGER) {
          throw new ForbiddenException(
            'Only managers can view pending reviews',
          );
        }
        const teamIds = await getReportingHierarchyIds(this.prisma, actorId);
        const pending = await this.prisma.review.findMany({
          where: {
            employeeId: { in: teamIds },
            status: { not: ReviewStatus.FINALIZED },
          },
          include: {
            employee: { select: { firstName: true, lastName: true } },
          },
        });
        if (pending.length === 0) return 'No pending reviews for your team.';
        return pending
          .map(
            (r) =>
              `${r.employee.firstName} ${r.employee.lastName}: ${r.status}`,
          )
          .join('\n');
      }
      default:
        return "I'm not able to help with that yet.";
    }
  }

  // Executes through the SAME service methods the manual UI uses — see
  // Section 7.14 Workflow: "action executes through the same APIs a
  // manual UI action would use."
  private async executeWriteTool(
    name: string,
    input: Record<string, unknown>,
    actorId: string,
  ) {
    if (name === 'apply_leave') {
      const actor = await this.prisma.employee.findUnique({
        where: { id: actorId },
        select: { companyId: true },
      });
      const leaveType = await this.prisma.leaveType.findFirst({
        where: {
          companyId: actor?.companyId,
          name: { equals: input.leaveTypeName as string, mode: 'insensitive' },
        },
      });
      if (!leaveType) {
        throw new BadRequestException(
          `Unknown leave type "${input.leaveTypeName as string}"`,
        );
      }
      return this.leaveService.applyLeave(actorId, {
        leaveTypeId: leaveType.id,
        startDate: input.startDate as string,
        endDate: input.endDate as string,
        reason: input.reason as string | undefined,
      });
    }

    if (name === 'raise_ticket') {
      return this.helpdeskService.createTicket(
        {
          category: input.category as never,
          subject: input.subject as string,
          description: input.description as string,
        },
        actorId,
      );
    }

    throw new BadRequestException(`Unknown action "${name}"`);
  }
}
