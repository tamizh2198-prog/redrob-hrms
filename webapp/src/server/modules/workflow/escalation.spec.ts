import type { PrismaClient } from "@prisma/client";
import * as escalation from "./escalation";

jest.mock("../../lib/notify", () => ({ notify: jest.fn().mockResolvedValue(undefined) }));
const { notify } = jest.requireMock("../../lib/notify") as { notify: jest.Mock };

function createMockPrisma() {
  return {
    approvalRequest: { findMany: jest.fn(), update: jest.fn() },
    employee: { findMany: jest.fn() },
  };
}

describe("workflow escalation", () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let db: PrismaClient;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma = createMockPrisma();
    db = prisma as unknown as PrismaClient;
  });

  it("escalates a step whose SLA has already elapsed, and marks it so it is not re-escalated", async () => {
    prisma.approvalRequest.findMany.mockResolvedValue([
      {
        id: "req-1",
        currentStep: 0,
        currentStepStartedAt: new Date(Date.now() - 5 * 60 * 60 * 1000), // 5h ago
        workflowDefinition: {
          companyId: "co-1",
          stepsJson: [{ sequence: 0, approverRules: [{ type: "MANAGER" }], requireAll: false, slaHours: 2 }],
        },
      },
    ]);
    prisma.employee.findMany.mockResolvedValue([{ id: "hr-1" }]);

    await escalation.escalateBreachedSteps(db);

    expect(notify).toHaveBeenCalledWith(db, expect.objectContaining({ recipientId: "hr-1", template: "workflow.sla-breach" }));
    expect(prisma.approvalRequest.update).toHaveBeenCalledWith({ where: { id: "req-1" }, data: { currentStepEscalatedAt: expect.any(Date) } });
  });

  it("does not escalate a step still within its SLA window", async () => {
    prisma.approvalRequest.findMany.mockResolvedValue([
      {
        id: "req-2",
        currentStep: 0,
        currentStepStartedAt: new Date(),
        workflowDefinition: {
          companyId: "co-1",
          stepsJson: [{ sequence: 0, approverRules: [{ type: "MANAGER" }], requireAll: false, slaHours: 24 }],
        },
      },
    ]);

    await escalation.escalateBreachedSteps(db);

    expect(notify).not.toHaveBeenCalled();
  });

  it("skips steps with no configured SLA", async () => {
    prisma.approvalRequest.findMany.mockResolvedValue([
      {
        id: "req-3",
        currentStep: 0,
        currentStepStartedAt: new Date(Date.now() - 100 * 60 * 60 * 1000),
        workflowDefinition: {
          companyId: "co-1",
          stepsJson: [{ sequence: 0, approverRules: [{ type: "MANAGER" }], requireAll: false }],
        },
      },
    ]);

    await escalation.escalateBreachedSteps(db);

    expect(notify).not.toHaveBeenCalled();
  });
});
