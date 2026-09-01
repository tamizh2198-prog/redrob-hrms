import type { PrismaClient } from "@prisma/client";
import { notify } from "../../lib/notify";
import type { WorkflowStepDef } from "./service";

function getStep(steps: WorkflowStepDef[], sequence: number): WorkflowStepDef | undefined {
  return steps.find((s) => s.sequence === sequence);
}

// Business Rule: "A step's SLA clock starts only once it becomes the active
// step" — orchestration only; same split as helpdesk/escalation.ts and
// announcements/reminders.ts.
export async function escalateBreachedSteps(prisma: PrismaClient): Promise<void> {
  const pending = await prisma.approvalRequest.findMany({
    where: { status: "PENDING", currentStepEscalatedAt: null },
    include: { workflowDefinition: true },
  });

  let escalated = 0;
  for (const request of pending) {
    const steps = request.workflowDefinition.stepsJson as unknown as WorkflowStepDef[];
    const step = getStep(steps, request.currentStep);
    if (!step?.slaHours) continue;

    const dueAt = new Date(request.currentStepStartedAt.getTime() + step.slaHours * 60 * 60 * 1000);
    if (dueAt > new Date()) continue;

    const targets = await prisma.employee.findMany({
      where: { companyId: request.workflowDefinition.companyId, role: step.escalationTargetRole ?? "HR_ADMIN" },
      select: { id: true },
    });
    for (const target of targets) {
      await notify(prisma, {
        recipientId: target.id,
        template: "workflow.sla-breach",
        body: `Workflow "${request.workflowDefinition.name}" (${request.sourceModule}) has breached its SLA at step ${request.currentStep} and needs your attention.`,
        data: { requestId: request.id, sourceModule: request.sourceModule },
      });
    }

    await prisma.approvalRequest.update({ where: { id: request.id }, data: { currentStepEscalatedAt: new Date() } });
    escalated++;
  }

  if (escalated > 0) {
    console.log(`Escalated ${escalated} SLA-breached workflow step(s)`);
  }
}
