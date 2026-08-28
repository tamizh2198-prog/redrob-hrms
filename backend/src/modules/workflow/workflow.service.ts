import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ApprovalDecision, Prisma, Role } from '@prisma/client';
import { PrismaService } from '../../shared/database/prisma.service';
import { NotificationService } from '../../shared/notifications/notification.service';
import { AssetsService } from '../assets/assets.service';
import { CreateWorkflowDefinitionDto } from './dto/create-workflow-definition.dto';
import { CreateApprovalRequestDto } from './dto/create-approval-request.dto';
import { DecideApprovalDto } from './dto/decide-approval.dto';
import type { ApproverRule, WorkflowStepDef } from './workflow-types';

export interface UnifiedApprovalItem {
  source: string; // 'WORKFLOW' | 'ASSETS' | 'ATS_REQUISITION' | 'ATS_OFFER'
  id: string;
  summary: string;
  requestedAt: Date;
}

function getStep(
  steps: WorkflowStepDef[],
  sequence: number,
): WorkflowStepDef | undefined {
  return steps.find((s) => s.sequence === sequence);
}

function evaluateCondition(
  step: WorkflowStepDef,
  context: Record<string, unknown>,
): boolean {
  if (!step.condition) return true;
  const actual = context[step.condition.field];
  if (typeof actual !== 'number') return false;
  switch (step.condition.operator) {
    case 'gt':
      return actual > step.condition.value;
    case 'gte':
      return actual >= step.condition.value;
    case 'lt':
      return actual < step.condition.value;
    case 'lte':
      return actual <= step.condition.value;
    case 'eq':
      return actual === step.condition.value;
  }
}

@Injectable()
export class WorkflowService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
    private readonly assetsService: AssetsService,
  ) {}

  async createDefinition(dto: CreateWorkflowDefinitionDto, actorId: string) {
    const actor = await this.prisma.employee.findUnique({
      where: { id: actorId },
      select: { companyId: true },
    });
    if (!actor) throw new NotFoundException('Employee not found');

    return this.prisma.workflowDefinition.create({
      data: {
        companyId: actor.companyId,
        name: dto.name,
        module: dto.module,
        stepsJson: dto.steps as unknown as Prisma.InputJsonValue,
        createdById: actorId,
      },
    });
  }

  listDefinitions() {
    return this.prisma.workflowDefinition.findMany({
      orderBy: { createdAt: 'desc' },
    });
  }

  // Section 7.15 Workflow: "Module creates an Approval Request against a
  // Workflow Definition -> Engine resolves approver(s) for the current
  // step(s) -> notifies." Steps whose condition fails against `context` are
  // skipped entirely (Key Feature: conditional branching) so currentStep
  // always lands on the first APPLICABLE step, not merely sequence 0.
  async createRequest(dto: CreateApprovalRequestDto, actorId: string) {
    const definition = await this.prisma.workflowDefinition.findUnique({
      where: { id: dto.workflowId },
    });
    if (!definition)
      throw new NotFoundException('Workflow definition not found');

    const steps = definition.stepsJson as unknown as WorkflowStepDef[];
    const context = dto.context ?? {};
    const firstApplicable = steps
      .slice()
      .sort((a, b) => a.sequence - b.sequence)
      .find((s) => evaluateCondition(s, context));

    if (!firstApplicable) {
      throw new BadRequestException(
        'No workflow step applies to the given context',
      );
    }

    const request = await this.prisma.approvalRequest.create({
      data: {
        workflowId: dto.workflowId,
        sourceModule: dto.sourceModule,
        sourceRecordId: dto.sourceRecordId,
        requestedById: actorId,
        contextJson: context as unknown as Prisma.InputJsonValue,
        currentStep: firstApplicable.sequence,
      },
    });

    await this.notifyCurrentStepApprovers(
      request.id,
      definition.stepsJson as unknown as WorkflowStepDef[],
      firstApplicable,
      request.requestedById,
    );
    return request;
  }

  async getRequest(id: string, requester: { userId?: string; role?: Role }) {
    const request = await this.prisma.approvalRequest.findUnique({
      where: { id },
      include: { decisions: true, workflowDefinition: true },
    });
    if (!request) throw new NotFoundException('Approval request not found');

    const isPrivileged =
      requester.role === Role.HR_ADMIN || requester.role === Role.SUPER_ADMIN;
    const isRequester = requester.userId === request.requestedById;
    if (!isPrivileged && !isRequester) {
      const steps = request.workflowDefinition
        .stepsJson as unknown as WorkflowStepDef[];
      const step = getStep(steps, request.currentStep);
      const slots = step
        ? await this.resolveStepApprovers(
            step,
            request.requestedById,
            request.workflowDefinition.companyId,
          )
        : [];
      const isEligibleApprover = slots.some(
        (eligible) => requester.userId && eligible.includes(requester.userId),
      );
      if (!isEligibleApprover) {
        throw new ForbiddenException(
          'Not authorized to view this approval request',
        );
      }
    }

    return request;
  }

  // Section 7.15 Business Rule: "Rejecting at any step terminates the whole
  // request" (resubmission-to-a-prior-step is intentionally NOT implemented
  // — deferred, no PRD requirement forced it for this pass). "A step's SLA
  // clock starts only once it becomes the active step" is reset here on
  // every advance.
  async decide(requestId: string, dto: DecideApprovalDto, actorId: string) {
    const request = await this.prisma.approvalRequest.findUnique({
      where: { id: requestId },
      include: { workflowDefinition: true, decisions: true },
    });
    if (!request) throw new NotFoundException('Approval request not found');
    if (request.status !== ApprovalDecision.PENDING) {
      throw new BadRequestException('This request has already been decided');
    }

    const steps = request.workflowDefinition
      .stepsJson as unknown as WorkflowStepDef[];
    const step = getStep(steps, request.currentStep);
    if (!step) throw new NotFoundException('Current workflow step not found');

    const slots = await this.resolveStepApprovers(
      step,
      request.requestedById,
      request.workflowDefinition.companyId,
    );
    const slotIndex = slots.findIndex((eligible) => eligible.includes(actorId));
    if (slotIndex === -1) {
      throw new ForbiddenException(
        'You are not an eligible approver for this step',
      );
    }

    const alreadyDecidedThisStep = request.decisions.some(
      (d) => d.step === request.currentStep && d.approverId === actorId,
    );
    if (alreadyDecidedThisStep) {
      throw new BadRequestException(
        'You have already recorded a decision for this step',
      );
    }

    await this.prisma.workflowApprovalDecision.create({
      data: {
        requestId: request.id,
        step: request.currentStep,
        approverId: actorId,
        decision: dto.decision,
        comment: dto.comment,
      },
    });

    if (dto.decision === 'REJECTED') {
      const updated = await this.prisma.approvalRequest.update({
        where: { id: request.id },
        data: { status: ApprovalDecision.REJECTED },
      });
      await this.notifications.send({
        recipientId: request.requestedById,
        template: 'workflow.request-rejected',
        body: `Your ${request.sourceModule} approval request ("${request.workflowDefinition.name}") was rejected.${dto.comment ? ` Comment: "${dto.comment}"` : ''}`,
        data: { requestId: request.id, sourceModule: request.sourceModule },
      });
      return updated;
    }

    // requireAll (parallel) steps only advance once every slot has an
    // APPROVED decision recorded.
    if (step.requireAll) {
      const decisionsThisStep = [
        ...request.decisions.filter((d) => d.step === request.currentStep),
        { approverId: actorId, decision: ApprovalDecision.APPROVED },
      ];
      const allSlotsApproved = slots.every((eligible) =>
        decisionsThisStep.some(
          (d) =>
            eligible.includes(d.approverId) &&
            d.decision === ApprovalDecision.APPROVED,
        ),
      );
      if (!allSlotsApproved) {
        return this.prisma.approvalRequest.findUnique({
          where: { id: request.id },
        });
      }
    }

    return this.advance(
      request.id,
      steps,
      request.currentStep,
      request.requestedById,
    );
  }

  private async advance(
    requestId: string,
    steps: WorkflowStepDef[],
    currentSequence: number,
    requestedById: string,
  ) {
    const requestForAdvance = await this.prisma.approvalRequest.findUnique({
      where: { id: requestId },
      select: {
        contextJson: true,
        sourceModule: true,
        workflowDefinition: { select: { name: true } },
      },
    });
    const context = (requestForAdvance?.contextJson ?? {}) as Record<
      string,
      unknown
    >;

    const next = steps
      .slice()
      .filter((s) => s.sequence > currentSequence)
      .sort((a, b) => a.sequence - b.sequence)
      .find((s) => evaluateCondition(s, context));

    if (!next) {
      const finished = await this.prisma.approvalRequest.update({
        where: { id: requestId },
        data: { status: ApprovalDecision.APPROVED },
      });
      await this.notifications.send({
        recipientId: requestedById,
        template: 'workflow.request-approved',
        body: `Your ${requestForAdvance?.sourceModule ?? ''} approval request ("${requestForAdvance?.workflowDefinition?.name ?? ''}") was fully approved.`,
        data: { requestId },
      });
      return finished;
    }

    const advanced = await this.prisma.approvalRequest.update({
      where: { id: requestId },
      data: {
        currentStep: next.sequence,
        currentStepStartedAt: new Date(),
        currentStepEscalatedAt: null,
      },
    });
    await this.notifyCurrentStepApprovers(
      requestId,
      steps,
      next,
      requestedById,
    );
    return advanced;
  }

  private async notifyCurrentStepApprovers(
    requestId: string,
    steps: WorkflowStepDef[],
    step: WorkflowStepDef,
    requestedById: string,
  ) {
    const definition = await this.prisma.approvalRequest.findUnique({
      where: { id: requestId },
      select: {
        sourceModule: true,
        workflowDefinition: { select: { companyId: true, name: true } },
      },
    });
    if (!definition) return;

    const slots = await this.resolveStepApprovers(
      step,
      requestedById,
      definition.workflowDefinition.companyId,
    );
    const approverIds = new Set(slots.flat());
    for (const approverId of approverIds) {
      await this.notifications.send({
        recipientId: approverId,
        template: 'workflow.approval-assigned',
        body: `A ${definition.sourceModule} approval request ("${definition.workflowDefinition.name}") is awaiting your decision.`,
        data: { requestId },
      });
    }
  }

  // Business Rule: "if none can be resolved... auto-escalates to HR Admin."
  // Returns one array of eligible employee ids per approverRule ("slot").
  private async resolveStepApprovers(
    step: WorkflowStepDef,
    requesterId: string,
    companyId: string,
  ): Promise<string[][]> {
    const slots: string[][] = [];
    for (const rule of step.approverRules) {
      const resolved = await this.resolveApproverRule(
        rule,
        requesterId,
        companyId,
      );
      slots.push(
        resolved.length > 0
          ? resolved
          : await this.fallbackToHrAdmin(companyId),
      );
    }
    return slots;
  }

  private async resolveApproverRule(
    rule: ApproverRule,
    requesterId: string,
    companyId: string,
  ): Promise<string[]> {
    if (rule.type === 'MANAGER') {
      const requester = await this.prisma.employee.findUnique({
        where: { id: requesterId },
        select: { reportingManagerId: true },
      });
      return requester?.reportingManagerId
        ? [requester.reportingManagerId]
        : [];
    }
    if (rule.type === 'SKIP_MANAGER') {
      const requester = await this.prisma.employee.findUnique({
        where: { id: requesterId },
        select: { reportingManagerId: true },
      });
      if (!requester?.reportingManagerId) return [];
      const manager = await this.prisma.employee.findUnique({
        where: { id: requester.reportingManagerId },
        select: { reportingManagerId: true },
      });
      return manager?.reportingManagerId ? [manager.reportingManagerId] : [];
    }
    // ROLE
    const people = await this.prisma.employee.findMany({
      where: { companyId, role: rule.role },
      select: { id: true },
    });
    return people.map((p) => p.id);
  }

  private async fallbackToHrAdmin(companyId: string): Promise<string[]> {
    const admins = await this.prisma.employee.findMany({
      where: { companyId, role: { in: [Role.HR_ADMIN, Role.SUPER_ADMIN] } },
      select: { id: true },
    });
    return admins.map((a) => a.id);
  }

  // Section 7.15 Acceptance Criteria: "A unified 'my approvals' inbox
  // correctly aggregates pending items across Assets, Offers and
  // Requisitions." This reads through each module's EXISTING list
  // method / equivalent scoping — it never re-implements their
  // approval business logic.
  async listMyApprovals(
    actorId: string,
    role: Role | undefined,
  ): Promise<UnifiedApprovalItem[]> {
    const items: UnifiedApprovalItem[] = [];

    const pendingRequests = await this.prisma.approvalRequest.findMany({
      where: { status: ApprovalDecision.PENDING },
      include: { workflowDefinition: true },
    });
    for (const request of pendingRequests) {
      const steps = request.workflowDefinition
        .stepsJson as unknown as WorkflowStepDef[];
      const step = getStep(steps, request.currentStep);
      if (!step) continue;
      const slots = await this.resolveStepApprovers(
        step,
        request.requestedById,
        request.workflowDefinition.companyId,
      );
      if (slots.some((eligible) => eligible.includes(actorId))) {
        items.push({
          source: 'WORKFLOW',
          id: request.id,
          summary: `${request.workflowDefinition.name} (${request.sourceModule})`,
          requestedAt: request.createdAt,
        });
      }
    }

    // Asset request approval is HR Admin/Super Admin only (see
    // AssetsService.decideAssetRequest) — a Manager has nothing to approve
    // here, so this source is skipped entirely for every other role rather
    // than querying an approver scope that no longer exists.
    if (role === Role.HR_ADMIN || role === Role.SUPER_ADMIN) {
      const assetRequests = await this.assetsService.listAssetRequests(
        {},
        { userId: actorId, role },
      );
      for (const req of assetRequests as Array<{
        id: string;
        status: string;
        assetCategory: string;
        createdAt: Date;
      }>) {
        if (req.status !== 'PENDING') continue;
        items.push({
          source: 'ASSETS',
          id: req.id,
          summary: `Asset request: ${req.assetCategory}`,
          requestedAt: req.createdAt,
        });
      }
    }

    if (role === Role.HR_ADMIN || role === Role.SUPER_ADMIN) {
      const requisitions = await this.prisma.jobRequisition.findMany({
        where: { status: 'PENDING_APPROVAL' },
      });
      for (const r of requisitions) {
        items.push({
          source: 'ATS_REQUISITION',
          id: r.id,
          summary: `Requisition: ${r.title}`,
          requestedAt: r.createdAt,
        });
      }

      const offersForHr = await this.prisma.offer.findMany({
        where: { status: 'PENDING_APPROVAL', hrApprovedAt: null },
        include: { candidate: true },
      });
      for (const o of offersForHr) {
        items.push({
          source: 'ATS_OFFER',
          id: o.id,
          summary: `Offer (HR sign-off): ${o.candidate.name}`,
          requestedAt: o.createdAt,
        });
      }
    }

    // No Manager-side offer sign-off block: offer approval is HR Admin/
    // Super Admin only (see AtsService.approveOffer) — a Manager never has
    // an offer waiting on their own decision.

    return items.sort(
      (a, b) => a.requestedAt.getTime() - b.requestedAt.getTime(),
    );
  }
}
