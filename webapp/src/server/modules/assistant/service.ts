import type { Prisma, PrismaClient, Role } from "@prisma/client";
import { getReportingHierarchyIds } from "../../lib/reporting-hierarchy";
import { BadRequestError, ForbiddenError, NotFoundError } from "../../lib/errors";
import { AssistantUnavailableError, complete, type LlmResponse, type LlmToolDef } from "../../lib/assistant-llm";
import * as holidayService from "../holiday/service";
import * as helpdeskService from "../helpdesk/service";
import type { SendMessageDto, ConfirmActionDto, UploadPolicyDocumentDto } from "./dto";

interface GroundedSource {
  docId: string;
  title: string;
  excerpt: string;
}

interface ProposedAction {
  type: string;
  input: Record<string, unknown>;
}

// Employee-facing actions. Read tools execute immediately (RBAC-scoped to
// the caller); write tools only ever get DRAFTED here — see WRITE_TOOLS /
// confirmAction().
const TOOLS: LlmToolDef[] = [
  {
    name: "raise_ticket",
    description: "Draft a helpdesk ticket for the requesting employee. Does NOT submit it — the user must separately confirm.",
    input_schema: {
      type: "object",
      properties: {
        category: {
          type: "string",
          enum: ["PAYROLL_QUERY", "LEAVE_ATTENDANCE_ISSUE", "IT_SUPPORT", "ADMIN_FACILITIES", "GENERAL_HR"],
        },
        subject: { type: "string" },
        description: { type: "string" },
      },
      required: ["category", "subject", "description"],
    },
  },
  {
    name: "view_holiday_calendar",
    description: "View the requesting employee's location holiday calendar for a year.",
    input_schema: {
      type: "object",
      properties: { year: { type: "integer" } },
    },
  },
];

// "Manager-facing queries" — only offered to MANAGER callers (see
// sendMessage), never surfaced to Employee tokens.
const MANAGER_TOOLS: LlmToolDef[] = [
  {
    name: "pending_reviews",
    description: "List the manager's team members whose performance review is not yet finalized.",
    input_schema: { type: "object", properties: {} },
  },
];

const WRITE_TOOLS = new Set(["raise_ticket"]);

// Workflow: "retrieves relevant policy/data (scoped to user's RBAC
// permissions) -> drafts an answer or proposed action -> user confirms (if
// any) -> executes through the same APIs a manual UI action would use ->
// logged." This function covers everything up to (and including) the
// propose step; confirmAction() covers execution.
export async function sendMessage(prisma: PrismaClient, actorId: string, role: Role | undefined, dto: SendMessageDto) {
  const conversation = await getOrCreateConversation(prisma, actorId, dto.conversationId);

  await prisma.assistantMessage.create({
    data: { conversationId: conversation.id, role: "USER", message: dto.message },
  });

  const groundedSources = await retrieveGroundedSources(prisma, actorId, dto.message);
  const tools = role === "MANAGER" ? [...TOOLS, ...MANAGER_TOOLS] : TOOLS;
  const systemPrompt = buildSystemPrompt(groundedSources);

  let llmResult: LlmResponse;
  try {
    llmResult = await complete(systemPrompt, dto.message, tools);
  } catch (err) {
    if (err instanceof AssistantUnavailableError) {
      return saveAssistantMessage(prisma, conversation.id, err.message, []);
    }
    throw err;
  }

  if (!llmResult.toolCall) {
    return saveAssistantMessage(prisma, conversation.id, llmResult.text, groundedSources);
  }

  const { name, input } = llmResult.toolCall;

  // AC: "Assistant never executes a write action without explicit
  // confirmation" — write tools are ALWAYS drafted, never run here.
  if (WRITE_TOOLS.has(name)) {
    return saveAssistantMessage(prisma, conversation.id, describeProposedAction(name, input), [], { type: name, input });
  }

  const resultText = await executeReadTool(prisma, name, input, actorId, role);
  return saveAssistantMessage(prisma, conversation.id, resultText, groundedSources);
}

export async function confirmAction(prisma: PrismaClient, actorId: string, dto: ConfirmActionDto) {
  const message = await prisma.assistantMessage.findUnique({
    where: { id: dto.messageId },
    include: { conversation: true },
  });
  if (!message || !message.proposedAction) {
    throw new NotFoundError("No pending action found for this message");
  }
  if (message.conversation.employeeId !== actorId) {
    throw new ForbiddenError("You cannot confirm another user's action");
  }
  if (message.actionTaken) {
    throw new BadRequestError("This action has already been executed");
  }

  const { type, input } = message.proposedAction as unknown as ProposedAction;
  const result = await executeWriteTool(prisma, type, input, actorId);

  // Business Rule: "tagged as 'AI-assisted' with the underlying user's
  // identity, not a generic system identity" — actorId here is the real
  // caller, passed straight through to the same helpdesk service functions
  // the manual UI uses.
  return prisma.assistantMessage.update({
    where: { id: message.id },
    data: {
      actionTaken: JSON.parse(
        JSON.stringify({ type, input, result, initiatedVia: "AI_ASSISTANT", actorId }),
      ) as Prisma.InputJsonValue,
    },
  });
}

export async function uploadPolicyDocument(prisma: PrismaClient, dto: UploadPolicyDocumentDto, actorId: string) {
  const actor = await prisma.employee.findUnique({ where: { id: actorId }, select: { companyId: true } });
  if (!actor) throw new NotFoundError("Employee not found");

  return prisma.policyDocument.create({
    data: { companyId: actor.companyId, title: dto.title, content: dto.content, uploadedById: actorId },
  });
}

export function listConversationMessages(prisma: PrismaClient, actorId: string, conversationId: string) {
  return prisma.assistantMessage.findMany({
    where: { conversationId, conversation: { employeeId: actorId } },
    orderBy: { createdAt: "asc" },
  });
}

async function getOrCreateConversation(prisma: PrismaClient, actorId: string, conversationId?: string) {
  if (conversationId) {
    const existing = await prisma.assistantConversation.findUnique({ where: { id: conversationId } });
    if (!existing || existing.employeeId !== actorId) {
      throw new ForbiddenError("You do not have access to this conversation");
    }
    return existing;
  }
  return prisma.assistantConversation.create({ data: { employeeId: actorId } });
}

async function saveAssistantMessage(
  prisma: PrismaClient,
  conversationId: string,
  text: string,
  groundedSources: GroundedSource[],
  proposedAction?: ProposedAction,
) {
  return prisma.assistantMessage.create({
    data: {
      conversationId,
      role: "ASSISTANT",
      message: text,
      groundedSources: groundedSources as unknown as Prisma.InputJsonValue,
      proposedAction: proposedAction as unknown as Prisma.InputJsonValue | undefined,
    },
  });
}

// Business Rule: "Policy answers must be grounded in indexed company
// documents." No vector DB in this stack — plain keyword-overlap scoring
// across each company's own PolicyDocument rows.
async function retrieveGroundedSources(prisma: PrismaClient, actorId: string, query: string): Promise<GroundedSource[]> {
  const actor = await prisma.employee.findUnique({ where: { id: actorId }, select: { companyId: true } });
  if (!actor) return [];

  const docs = await prisma.policyDocument.findMany({ where: { companyId: actor.companyId } });
  const terms = query
    .toLowerCase()
    .split(/\W+/)
    .filter((t) => t.length > 2);

  return docs
    .map((doc) => ({
      doc,
      score: terms.reduce(
        (sum, t) => sum + (doc.content.toLowerCase().includes(t) ? 1 : 0) + (doc.title.toLowerCase().includes(t) ? 2 : 0),
        0,
      ),
    }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((s) => ({ docId: s.doc.id, title: s.doc.title, excerpt: s.doc.content.slice(0, 800) }));
}

function buildSystemPrompt(sources: GroundedSource[]): string {
  const sourcesText = sources.length
    ? sources.map((s) => `[Source: ${s.title}]\n${s.excerpt}`).join("\n\n")
    : "No matching policy documents were found for this question.";

  return [
    "You are the Redrob HRMS assistant. You help employees with HR policy questions and can propose (never directly execute) HR actions via tools.",
    "RULES:",
    "- Answer policy questions ONLY using the POLICY SOURCES below. If they do not contain the answer, say you don't have this information and to contact HR — never guess or invent policy.",
    "- Never claim an action has been completed. Any tool you call for a write action is only a DRAFT pending the user's explicit confirmation.",
    "- Cite which policy document you used, if any.",
    "",
    "POLICY SOURCES:",
    sourcesText,
  ].join("\n");
}

function describeProposedAction(name: string, input: Record<string, unknown>): string {
  const str = (v: unknown) => (typeof v === "string" ? v : "");

  if (name === "raise_ticket") {
    return `I can raise a ${str(input.category)} helpdesk ticket titled "${str(input.subject)}". Please confirm to submit it.`;
  }
  return "Please confirm to proceed with this action.";
}

async function executeReadTool(
  prisma: PrismaClient,
  name: string,
  input: Record<string, unknown>,
  actorId: string,
  role: Role | undefined,
): Promise<string> {
  switch (name) {
    case "view_holiday_calendar": {
      const actor = await prisma.employee.findUnique({ where: { id: actorId }, select: { locationId: true } });
      if (!actor?.locationId) {
        return "You do not have a location assigned, so I cannot show your holiday calendar.";
      }
      const year = (input.year as number | undefined) ?? new Date().getUTCFullYear();
      const holidays = await holidayService.listCalendar(prisma, actor.locationId, year);
      if (holidays.length === 0) return `No holidays found for ${year}.`;
      return holidays.map((h) => `${h.date.toISOString().slice(0, 10)}: ${h.name}`).join("\n");
    }
    case "pending_reviews": {
      if (role !== "MANAGER") {
        throw new ForbiddenError("Only managers can view pending reviews");
      }
      const teamIds = await getReportingHierarchyIds(prisma, actorId);
      const pending = await prisma.review.findMany({
        where: { employeeId: { in: teamIds }, status: { not: "FINALIZED" } },
        include: { employee: { select: { firstName: true, lastName: true } } },
      });
      if (pending.length === 0) return "No pending reviews for your team.";
      return pending.map((r) => `${r.employee.firstName} ${r.employee.lastName}: ${r.status}`).join("\n");
    }
    default:
      return "I'm not able to help with that yet.";
  }
}

// Executes through the SAME service functions the manual UI uses.
async function executeWriteTool(prisma: PrismaClient, name: string, input: Record<string, unknown>, actorId: string) {
  if (name === "raise_ticket") {
    return helpdeskService.createTicket(
      prisma,
      { category: input.category as never, subject: input.subject as string, description: input.description as string },
      actorId,
    );
  }

  throw new BadRequestError(`Unknown action "${name}"`);
}
