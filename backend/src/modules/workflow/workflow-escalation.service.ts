import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ApprovalDecision, Role } from '@prisma/client';
import { PrismaService } from '../../shared/database/prisma.service';
import { NotificationService } from '../../shared/notifications/notification.service';
import type { WorkflowStepDef } from './workflow-types';

function getStep(
  steps: WorkflowStepDef[],
  sequence: number,
): WorkflowStepDef | undefined {
  return steps.find((s) => s.sequence === sequence);
}

// Section 7.15 Business Rule: "A step's SLA clock starts only once it
// becomes the active step" — orchestration only; same split as
// HelpdeskEscalationService / AnnouncementsRemindersService.
@Injectable()
export class WorkflowEscalationService {
  private readonly logger = new Logger(WorkflowEscalationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async escalateBreachedSteps(): Promise<void> {
    const pending = await this.prisma.approvalRequest.findMany({
      where: { status: ApprovalDecision.PENDING, currentStepEscalatedAt: null },
      include: { workflowDefinition: true },
    });

    let escalated = 0;
    for (const request of pending) {
      const steps = request.workflowDefinition
        .stepsJson as unknown as WorkflowStepDef[];
      const step = getStep(steps, request.currentStep);
      if (!step?.slaHours) continue;

      const dueAt = new Date(
        request.currentStepStartedAt.getTime() + step.slaHours * 60 * 60 * 1000,
      );
      if (dueAt > new Date()) continue;

      const targets = await this.prisma.employee.findMany({
        where: {
          companyId: request.workflowDefinition.companyId,
          role: step.escalationTargetRole ?? Role.HR_ADMIN,
        },
        select: { id: true },
      });
      for (const target of targets) {
        await this.notifications.send({
          recipientId: target.id,
          template: 'workflow.sla-breach',
          data: { requestId: request.id, sourceModule: request.sourceModule },
        });
      }

      await this.prisma.approvalRequest.update({
        where: { id: request.id },
        data: { currentStepEscalatedAt: new Date() },
      });
      escalated++;
    }

    if (escalated > 0) {
      this.logger.log(`Escalated ${escalated} SLA-breached workflow step(s)`);
    }
  }
}
