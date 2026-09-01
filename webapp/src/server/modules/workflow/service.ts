import type { PrismaClient, Prisma, Role } from "@prisma/client";
import { notify } from "../../lib/notify";
import { BadRequestError, ForbiddenError, NotFoundError } from "../../lib/errors";
import { listAssetRequests } from "../assets/service";
import type { CreateApprovalRequestDto, CreateWorkflowDefinitionDto, DecideApprovalDto } from "./dto";

export interface UnifiedApprovalItem {
  source: string; // 'WORKFLOW' | 'ASSETS' | 'ATS_REQUISITION' | 'ATS_OFFER'
  id: string;
  summary: string;
  requestedAt: Date;
}

// Key Feature: "each step's approver resolved dynamically." ROLE resolves
// to every employee holding that role in the company (any one of them may
// act on that slot) — there's no per-role "named individual" concept in
// this system beyond Role itself.
export interface ApproverRule {
  type: "MANAGER" | "SKIP_MANAGER" | "ROLE";
  role?: Role; // required when type === 'ROLE'
}

export interface StepCondition {
  field: string;
  operator: "gt" | "gte" | "lt" | "lte" | "eq";
  value: number;
}

// Key Feature: "Parallel approval support" — a step with more than one
// approverRule and requireAll:true only completes once EVERY rule's slot
// has an APPROVED decision (Offboarding's 4-department use case); a
// single-rule step (or requireAll:false) completes on the first decision.
export interface WorkflowStepDef {
  sequence: number;
  approverRules: ApproverRule[];
  requireAll: boolean;
  slaHours?: number;
  escalationTargetRole?: Role; // defaults to HR_ADMIN if unset
  condition?: StepCondition; // Key Feature: conditional branching
}

function getStep(steps: WorkflowStepDef[], sequence: number): WorkflowStepDef | undefined {
  return steps.find((s) => s.sequence === sequence);
}

function evaluateCondition(step: WorkflowStepDef, context: Record<string, unknown>): boolean {
  if (!step.condition) return true;
  const actual = context[step.condition.field];
  if (typeof actual !== "number") return false;
  switch (step.condition.operator) {
    case "gt":
      return actual > step.condition.value;
    case "gte":
      return actual >= step.condition.value;
    case "lt":
      return actual < step.condition.value;
    case "lte":
      return actual <= step.condition.value;
    case "eq":
      return actual === step.condition.value;
  }
}

export async function createDefinition(prisma: PrismaClient, dto: CreateWorkflowDefinitionDto, actorId: string) {
  const actor = await prisma.employee.findUnique({ where: { id: actorId }, select: { companyId: true } });
  if (!actor) throw new NotFoundError("Employee not found");

  return prisma.workflowDefinition.create({
    data: {
      companyId: actor.companyId,
      name: dto.name,
      module: dto.module,
      stepsJson: dto.steps as unknown as Prisma.InputJsonValue,
      createdById: actorId,
    },
  });
}

export function listDefinitions(prisma: PrismaClient) {
  return prisma.workflowDefinition.findMany({ orderBy: { createdAt: "desc" } });
}

// "Module creates an Approval Request against a Workflow Definition ->
// Engine resolves approver(s) for the current step(s) -> notifies." Steps
// whose condition fails against `context` are skipped entirely (Key
// Feature: conditional branching) so currentStep always lands on the first
// APPLICABLE step, not merely sequence 0.
export async function createRequest(prisma: PrismaClient, dto: CreateApprovalRequestDto, actorId: string) {
  const definition = await prisma.workflowDefinition.findUnique({ where: { id: dto.workflowId } });
  if (!definition) throw new NotFoundError("Workflow definition not found");

  const steps = definition.stepsJson as unknown as WorkflowStepDef[];
  const context = dto.context ?? {};
  const firstApplicable = steps
    .slice()
    .sort((a, b) => a.sequence - b.sequence)
    .find((s) => evaluateCondition(s, context));

  if (!firstApplicable) {
    throw new BadRequestError("No workflow step applies to the given context");
  }

  const request = await prisma.approvalRequest.create({
    data: {
      workflowId: dto.workflowId,
      sourceModule: dto.sourceModule,
      sourceRecordId: dto.sourceRecordId,
      requestedById: actorId,
      contextJson: context as unknown as Prisma.InputJsonValue,
      currentStep: firstApplicable.sequence,
    },
  });

  await notifyCurrentStepApprovers(prisma, request.id, definition.stepsJson as unknown as WorkflowStepDef[], firstApplicable, request.requestedById);
  return request;
}

export async function getRequest(prisma: PrismaClient, id: string, requester: { userId?: string; role?: Role }) {
  const request = await prisma.approvalRequest.findUnique({
    where: { id },
    include: { decisions: true, workflowDefinition: true },
  });
  if (!request) throw new NotFoundError("Approval request not found");

  // Viewing only — not a decision, so HR_ASSOCIATE is included here (unlike
  // listMyApprovals below and the approver-resolution functions, which stay
  // HR_ADMIN/SUPER_ADMIN-only so HR_ASSOCIATE never becomes an eligible
  // decider).
  const isPrivileged = requester.role === "HR_ADMIN" || requester.role === "SUPER_ADMIN" || requester.role === "HR_ASSOCIATE";
  const isRequester = requester.userId === request.requestedById;
  if (!isPrivileged && !isRequester) {
    const steps = request.workflowDefinition.stepsJson as unknown as WorkflowStepDef[];
    const step = getStep(steps, request.currentStep);
    const slots = step ? await resolveStepApprovers(prisma, step, request.requestedById, request.workflowDefinition.companyId) : [];
    const isEligibleApprover = slots.some((eligible) => requester.userId && eligible.includes(requester.userId));
    if (!isEligibleApprover) {
      throw new ForbiddenError("Not authorized to view this approval request");
    }
  }

  return request;
}

// Business Rule: "Rejecting at any step terminates the whole request"
// (resubmission-to-a-prior-step is intentionally NOT implemented). "A
// step's SLA clock starts only once it becomes the active step" is reset
// here on every advance.
export async function decide(prisma: PrismaClient, requestId: string, dto: DecideApprovalDto, actorId: string) {
  const request = await prisma.approvalRequest.findUnique({
    where: { id: requestId },
    include: { workflowDefinition: true, decisions: true },
  });
  if (!request) throw new NotFoundError("Approval request not found");
  if (request.status !== "PENDING") {
    throw new BadRequestError("This request has already been decided");
  }

  const steps = request.workflowDefinition.stepsJson as unknown as WorkflowStepDef[];
  const step = getStep(steps, request.currentStep);
  if (!step) throw new NotFoundError("Current workflow step not found");

  const slots = await resolveStepApprovers(prisma, step, request.requestedById, request.workflowDefinition.companyId);
  const slotIndex = slots.findIndex((eligible) => eligible.includes(actorId));
  if (slotIndex === -1) {
    throw new ForbiddenError("You are not an eligible approver for this step");
  }

  const alreadyDecidedThisStep = request.decisions.some((d) => d.step === request.currentStep && d.approverId === actorId);
  if (alreadyDecidedThisStep) {
    throw new BadRequestError("You have already recorded a decision for this step");
  }

  await prisma.workflowApprovalDecision.create({
    data: { requestId: request.id, step: request.currentStep, approverId: actorId, decision: dto.decision, comment: dto.comment },
  });

  if (dto.decision === "REJECTED") {
    const updated = await prisma.approvalRequest.update({
      where: { id: request.id },
      data: { status: "REJECTED" },
    });
    await notify(prisma, {
      recipientId: request.requestedById,
      template: "workflow.request-rejected",
      body: `Your ${request.sourceModule} approval request ("${request.workflowDefinition.name}") was rejected.${dto.comment ? ` Comment: "${dto.comment}"` : ""}`,
      data: { requestId: request.id, sourceModule: request.sourceModule },
    });
    return updated;
  }

  // requireAll (parallel) steps only advance once every slot has an
  // APPROVED decision recorded.
  if (step.requireAll) {
    const decisionsThisStep = [
      ...request.decisions.filter((d) => d.step === request.currentStep),
      { approverId: actorId, decision: "APPROVED" as const },
    ];
    const allSlotsApproved = slots.every((eligible) =>
      decisionsThisStep.some((d) => eligible.includes(d.approverId) && d.decision === "APPROVED"),
    );
    if (!allSlotsApproved) {
      return prisma.approvalRequest.findUnique({ where: { id: request.id } });
    }
  }

  return advance(prisma, request.id, steps, request.currentStep, request.requestedById);
}

async function advance(prisma: PrismaClient, requestId: string, steps: WorkflowStepDef[], currentSequence: number, requestedById: string) {
  const requestForAdvance = await prisma.approvalRequest.findUnique({
    where: { id: requestId },
    select: { contextJson: true, sourceModule: true, workflowDefinition: { select: { name: true } } },
  });
  const context = (requestForAdvance?.contextJson ?? {}) as Record<string, unknown>;

  const next = steps
    .slice()
    .filter((s) => s.sequence > currentSequence)
    .sort((a, b) => a.sequence - b.sequence)
    .find((s) => evaluateCondition(s, context));

  if (!next) {
    const finished = await prisma.approvalRequest.update({
      where: { id: requestId },
      data: { status: "APPROVED" },
    });
    await notify(prisma, {
      recipientId: requestedById,
      template: "workflow.request-approved",
      body: `Your ${requestForAdvance?.sourceModule ?? ""} approval request ("${requestForAdvance?.workflowDefinition?.name ?? ""}") was fully approved.`,
      data: { requestId },
    });
    return finished;
  }

  const advanced = await prisma.approvalRequest.update({
    where: { id: requestId },
    data: { currentStep: next.sequence, currentStepStartedAt: new Date(), currentStepEscalatedAt: null },
  });
  await notifyCurrentStepApprovers(prisma, requestId, steps, next, requestedById);
  return advanced;
}

async function notifyCurrentStepApprovers(prisma: PrismaClient, requestId: string, steps: WorkflowStepDef[], step: WorkflowStepDef, requestedById: string) {
  const definition = await prisma.approvalRequest.findUnique({
    where: { id: requestId },
    select: { sourceModule: true, workflowDefinition: { select: { companyId: true, name: true } } },
  });
  if (!definition) return;

  const slots = await resolveStepApprovers(prisma, step, requestedById, definition.workflowDefinition.companyId);
  const approverIds = new Set(slots.flat());
  for (const approverId of approverIds) {
    await notify(prisma, {
      recipientId: approverId,
      template: "workflow.approval-assigned",
      body: `A ${definition.sourceModule} approval request ("${definition.workflowDefinition.name}") is awaiting your decision.`,
      data: { requestId },
    });
  }
}

// Business Rule: "if none can be resolved... auto-escalates to HR Admin."
// Returns one array of eligible employee ids per approverRule ("slot").
async function resolveStepApprovers(prisma: PrismaClient, step: WorkflowStepDef, requesterId: string, companyId: string): Promise<string[][]> {
  const slots: string[][] = [];
  for (const rule of step.approverRules) {
    const resolved = await resolveApproverRule(prisma, rule, requesterId, companyId);
    slots.push(resolved.length > 0 ? resolved : await fallbackToHrAdmin(prisma, companyId));
  }
  return slots;
}

async function resolveApproverRule(prisma: PrismaClient, rule: ApproverRule, requesterId: string, companyId: string): Promise<string[]> {
  if (rule.type === "MANAGER") {
    const requester = await prisma.employee.findUnique({ where: { id: requesterId }, select: { reportingManagerId: true } });
    return requester?.reportingManagerId ? [requester.reportingManagerId] : [];
  }
  if (rule.type === "SKIP_MANAGER") {
    const requester = await prisma.employee.findUnique({ where: { id: requesterId }, select: { reportingManagerId: true } });
    if (!requester?.reportingManagerId) return [];
    const manager = await prisma.employee.findUnique({ where: { id: requester.reportingManagerId }, select: { reportingManagerId: true } });
    return manager?.reportingManagerId ? [manager.reportingManagerId] : [];
  }
  // ROLE
  const people = await prisma.employee.findMany({ where: { companyId, role: rule.role }, select: { id: true } });
  return people.map((p) => p.id);
}

async function fallbackToHrAdmin(prisma: PrismaClient, companyId: string): Promise<string[]> {
  const admins = await prisma.employee.findMany({
    where: { companyId, role: { in: ["HR_ADMIN", "SUPER_ADMIN"] } },
    select: { id: true },
  });
  return admins.map((a) => a.id);
}

// Acceptance Criteria: "A unified 'my approvals' inbox correctly
// aggregates pending items across Assets, Offers and Requisitions." This
// reads through each source's own scoping — it never re-implements their
// approval business logic.
export async function listMyApprovals(prisma: PrismaClient, actorId: string, role: Role | undefined): Promise<UnifiedApprovalItem[]> {
  const items: UnifiedApprovalItem[] = [];

  const pendingRequests = await prisma.approvalRequest.findMany({
    where: { status: "PENDING" },
    include: { workflowDefinition: true },
  });
  for (const request of pendingRequests) {
    const steps = request.workflowDefinition.stepsJson as unknown as WorkflowStepDef[];
    const step = getStep(steps, request.currentStep);
    if (!step) continue;
    const slots = await resolveStepApprovers(prisma, step, request.requestedById, request.workflowDefinition.companyId);
    if (slots.some((eligible) => eligible.includes(actorId))) {
      items.push({
        source: "WORKFLOW",
        id: request.id,
        summary: `${request.workflowDefinition.name} (${request.sourceModule})`,
        requestedAt: request.createdAt,
      });
    }
  }

  // Asset request approval is HR Admin/Super Admin only — a Manager has
  // nothing to approve here, so this source is skipped entirely for every
  // other role rather than querying an approver scope that no longer
  // exists.
  if (role === "HR_ADMIN" || role === "SUPER_ADMIN") {
    const assetRequests = await listAssetRequests(prisma, {}, { userId: actorId, role });
    for (const req of assetRequests) {
      if (req.status !== "PENDING") continue;
      items.push({
        source: "ASSETS",
        id: req.id,
        summary: `Asset request: ${req.assetCategory}`,
        requestedAt: req.createdAt,
      });
    }
  }

  if (role === "HR_ADMIN" || role === "SUPER_ADMIN") {
    const requisitions = await prisma.jobRequisition.findMany({ where: { status: "PENDING_APPROVAL" } });
    for (const r of requisitions) {
      items.push({ source: "ATS_REQUISITION", id: r.id, summary: `Requisition: ${r.title}`, requestedAt: r.createdAt });
    }

    const offersForHr = await prisma.offer.findMany({
      where: { status: "PENDING_APPROVAL", hrApprovedAt: null },
      include: { candidate: true },
    });
    for (const o of offersForHr) {
      items.push({ source: "ATS_OFFER", id: o.id, summary: `Offer (HR sign-off): ${o.candidate.name}`, requestedAt: o.createdAt });
    }
  }

  // No Manager-side offer sign-off block: offer approval is HR Admin/Super
  // Admin only — a Manager never has an offer waiting on their own
  // decision.

  return items.sort((a, b) => a.requestedAt.getTime() - b.requestedAt.getTime());
}
