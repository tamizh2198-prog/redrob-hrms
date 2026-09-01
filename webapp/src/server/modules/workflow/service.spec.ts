import type { PrismaClient } from "@prisma/client";
import * as workflowService from "./service";

function createMockPrisma() {
  return {
    employee: { findUnique: jest.fn(), findMany: jest.fn() },
    workflowDefinition: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
    approvalRequest: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
    workflowApprovalDecision: { create: jest.fn() },
    jobRequisition: { findMany: jest.fn().mockResolvedValue([]) },
    offer: { findMany: jest.fn().mockResolvedValue([]) },
    assetRequest: { findMany: jest.fn().mockResolvedValue([]) },
  };
}

jest.mock("../../lib/notify");

// A 2-step sequential definition mirroring "Leave Approval > 5 days":
// step 0 = manager, always applies; step 1 = finance (ROLE:HR_ADMIN), only
// applies when context.daysCount > 10.
const LEAVE_LIKE_STEPS = [
  { sequence: 0, approverRules: [{ type: "MANAGER" }], requireAll: false },
  {
    sequence: 1,
    approverRules: [{ type: "ROLE", role: "HR_ADMIN" }],
    requireAll: false,
    condition: { field: "daysCount", operator: "gt", value: 10 },
  },
];

// A single parallel step mirroring Offboarding's 4-department clearance.
const PARALLEL_STEPS = [
  {
    sequence: 0,
    approverRules: [{ type: "ROLE", role: "HR_ADMIN" }, { type: "MANAGER" }],
    requireAll: true,
  },
];

describe("workflow service", () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let db: PrismaClient;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma = createMockPrisma();
    prisma.jobRequisition.findMany.mockResolvedValue([]);
    prisma.offer.findMany.mockResolvedValue([]);
    prisma.assetRequest.findMany.mockResolvedValue([]);
    db = prisma as unknown as PrismaClient;
    prisma.employee.findUnique.mockResolvedValue({ id: "req-1", companyId: "co-1", reportingManagerId: "mgr-1" });
  });

  describe("Key Feature: conditional branching (Leave > threshold use case)", () => {
    it("lands the request on step 0 when the condition on step 1 is not met", async () => {
      prisma.workflowDefinition.findUnique.mockResolvedValue({ id: "wf-1", companyId: "co-1", stepsJson: LEAVE_LIKE_STEPS });
      prisma.approvalRequest.create.mockResolvedValue({ id: "req-a", requestedById: "req-1", currentStep: 0 });
      prisma.approvalRequest.findUnique.mockResolvedValue({ workflowDefinition: { companyId: "co-1" } });

      const created = await workflowService.createRequest(
        db,
        { workflowId: "wf-1", sourceModule: "LEAVE", sourceRecordId: "leave-1", context: { daysCount: 3 } } as never,
        "req-1",
      );

      expect(prisma.approvalRequest.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ currentStep: 0 }) }),
      );
      expect(created).toBeDefined();
    });

    it("includes the finance step in eligibility once the condition is met (daysCount > 10)", async () => {
      // Verified via advance(): approving step 0 should route to step 1 when daysCount=12.
      prisma.workflowDefinition.findUnique.mockResolvedValue({ id: "wf-1", companyId: "co-1", stepsJson: LEAVE_LIKE_STEPS });
      prisma.approvalRequest.findUnique
        .mockResolvedValueOnce({
          id: "req-a",
          status: "PENDING",
          currentStep: 0,
          requestedById: "req-1",
          contextJson: { daysCount: 12 },
          workflowDefinition: { companyId: "co-1", stepsJson: LEAVE_LIKE_STEPS },
          decisions: [],
        })
        .mockResolvedValueOnce({ contextJson: { daysCount: 12 } });
      prisma.employee.findUnique
        .mockResolvedValueOnce({ reportingManagerId: "mgr-1" }) // resolve MANAGER slot for decide()
        .mockResolvedValueOnce({ reportingManagerId: "mgr-1" }); // resolve MANAGER slot again in notify
      prisma.approvalRequest.update.mockResolvedValue({ id: "req-a", currentStep: 1 });

      await workflowService.decide(db, "req-a", { decision: "APPROVED" } as never, "mgr-1");

      expect(prisma.approvalRequest.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ currentStep: 1 }) }),
      );
    });
  });

  describe("Key Feature: parallel approval (Offboarding 4-department use case)", () => {
    it("does not advance the request until every slot has approved", async () => {
      prisma.approvalRequest.findUnique.mockResolvedValue({
        id: "req-b",
        status: "PENDING",
        currentStep: 0,
        requestedById: "req-1",
        contextJson: {},
        workflowDefinition: { companyId: "co-1", stepsJson: PARALLEL_STEPS },
        decisions: [],
      });
      prisma.employee.findMany.mockResolvedValue([{ id: "hr-1" }]); // ROLE:HR_ADMIN slot
      prisma.employee.findUnique.mockResolvedValue({ reportingManagerId: "mgr-1" }); // MANAGER slot

      await workflowService.decide(db, "req-b", { decision: "APPROVED" } as never, "hr-1");

      expect(prisma.approvalRequest.update).not.toHaveBeenCalled();
    });

    it("advances once the second (final) slot approves", async () => {
      prisma.approvalRequest.findUnique
        .mockResolvedValueOnce({
          id: "req-b",
          status: "PENDING",
          currentStep: 0,
          requestedById: "req-1",
          contextJson: {},
          workflowDefinition: { companyId: "co-1", stepsJson: PARALLEL_STEPS },
          decisions: [{ step: 0, approverId: "hr-1", decision: "APPROVED" }],
        })
        .mockResolvedValueOnce({ contextJson: {} });
      prisma.employee.findMany.mockResolvedValue([{ id: "hr-1" }]);
      prisma.employee.findUnique.mockResolvedValue({ reportingManagerId: "mgr-1" });
      prisma.approvalRequest.update.mockResolvedValue({ id: "req-b", status: "APPROVED" });

      const { notify } = jest.requireMock("../../lib/notify");
      await workflowService.decide(db, "req-b", { decision: "APPROVED" } as never, "mgr-1");

      expect(prisma.approvalRequest.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: "APPROVED" }) }),
      );
      expect(notify).toHaveBeenCalledWith(db, expect.objectContaining({ template: "workflow.request-approved" }));
    });

    it("a single reject on a parallel step terminates the whole request immediately", async () => {
      prisma.approvalRequest.findUnique.mockResolvedValue({
        id: "req-b",
        status: "PENDING",
        currentStep: 0,
        requestedById: "req-1",
        contextJson: {},
        workflowDefinition: { companyId: "co-1", stepsJson: PARALLEL_STEPS },
        decisions: [],
      });
      prisma.employee.findMany.mockResolvedValue([{ id: "hr-1" }]);
      prisma.employee.findUnique.mockResolvedValue({ reportingManagerId: "mgr-1" });
      prisma.approvalRequest.update.mockResolvedValue({ id: "req-b", status: "REJECTED" });

      const { notify } = jest.requireMock("../../lib/notify");
      await workflowService.decide(db, "req-b", { decision: "REJECTED" } as never, "hr-1");

      expect(prisma.approvalRequest.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: "REJECTED" } }),
      );
      expect(notify).toHaveBeenCalledWith(db, expect.objectContaining({ template: "workflow.request-rejected" }));
    });
  });

  describe("Business Rule: unresolvable approver auto-escalates to HR Admin", () => {
    it("falls back to HR_ADMIN when the requester has no reporting manager", async () => {
      prisma.approvalRequest.findUnique.mockResolvedValue({
        id: "req-c",
        status: "PENDING",
        currentStep: 0,
        requestedById: "orphan-1",
        contextJson: {},
        workflowDefinition: {
          companyId: "co-1",
          stepsJson: [{ sequence: 0, approverRules: [{ type: "MANAGER" }], requireAll: false }],
        },
        decisions: [],
      });
      prisma.employee.findUnique.mockResolvedValue({ reportingManagerId: null });
      prisma.employee.findMany.mockResolvedValue([{ id: "hr-fallback" }]);
      prisma.approvalRequest.update.mockResolvedValue({ id: "req-c", status: "APPROVED" });

      await workflowService.decide(db, "req-c", { decision: "APPROVED" } as never, "hr-fallback");

      expect(prisma.approvalRequest.update).toHaveBeenCalled();
    });
  });

  describe("RBAC and invalid-path handling", () => {
    it("rejects a decision from someone who is not an eligible approver", async () => {
      prisma.approvalRequest.findUnique.mockResolvedValue({
        id: "req-d",
        status: "PENDING",
        currentStep: 0,
        requestedById: "req-1",
        contextJson: {},
        workflowDefinition: {
          companyId: "co-1",
          stepsJson: [{ sequence: 0, approverRules: [{ type: "MANAGER" }], requireAll: false }],
        },
        decisions: [],
      });
      prisma.employee.findUnique.mockResolvedValue({ reportingManagerId: "mgr-1" });

      await expect(workflowService.decide(db, "req-d", { decision: "APPROVED" } as never, "random-1")).rejects.toThrow(
        "not an eligible approver",
      );
    });

    it("lets HR Associate view any request, like HR Admin, even when not the requester or an eligible approver", async () => {
      prisma.approvalRequest.findUnique.mockResolvedValue({
        id: "req-view",
        status: "PENDING",
        currentStep: 0,
        requestedById: "req-1",
        decisions: [],
        workflowDefinition: {
          companyId: "co-1",
          stepsJson: [{ sequence: 0, approverRules: [{ type: "MANAGER" }], requireAll: false }],
        },
      });

      await expect(
        workflowService.getRequest(db, "req-view", { userId: "ha-1", role: "HR_ASSOCIATE" as never }),
      ).resolves.toBeDefined();
    });

    it("rejects a second decision from the same approver on the same step", async () => {
      prisma.approvalRequest.findUnique.mockResolvedValue({
        id: "req-e",
        status: "PENDING",
        currentStep: 0,
        requestedById: "req-1",
        contextJson: {},
        workflowDefinition: {
          companyId: "co-1",
          stepsJson: [{ sequence: 0, approverRules: [{ type: "MANAGER" }], requireAll: false }],
        },
        decisions: [{ step: 0, approverId: "mgr-1", decision: "APPROVED" }],
      });
      prisma.employee.findUnique.mockResolvedValue({ reportingManagerId: "mgr-1" });

      await expect(workflowService.decide(db, "req-e", { decision: "APPROVED" } as never, "mgr-1")).rejects.toThrow(
        "already recorded a decision",
      );
    });

    it("rejects deciding on a request that is already finalized", async () => {
      prisma.approvalRequest.findUnique.mockResolvedValue({ id: "req-f", status: "APPROVED" });
      await expect(workflowService.decide(db, "req-f", { decision: "APPROVED" } as never, "mgr-1")).rejects.toThrow(
        "already been decided",
      );
    });

    it("throws NotFoundError for an unknown request", async () => {
      prisma.approvalRequest.findUnique.mockResolvedValue(null);
      await expect(workflowService.decide(db, "missing", { decision: "APPROVED" } as never, "mgr-1")).rejects.toThrow(
        "Approval request not found",
      );
    });

    it("rejects creating a request when no step condition applies", async () => {
      prisma.workflowDefinition.findUnique.mockResolvedValue({
        id: "wf-2",
        companyId: "co-1",
        stepsJson: [
          { sequence: 0, approverRules: [{ type: "MANAGER" }], requireAll: false, condition: { field: "amount", operator: "gt", value: 1000 } },
        ],
      });
      await expect(
        workflowService.createRequest(
          db,
          { workflowId: "wf-2", sourceModule: "X", sourceRecordId: "x-1", context: { amount: 5 } } as never,
          "req-1",
        ),
      ).rejects.toThrow("No workflow step applies");
    });
  });

  describe("Acceptance Criteria: unified my-approvals inbox aggregates across modules", () => {
    it("aggregates native workflow requests plus Assets pending items", async () => {
      prisma.approvalRequest.findMany.mockResolvedValue([
        {
          id: "wf-req-1",
          requestedById: "req-1",
          sourceModule: "CUSTOM",
          createdAt: new Date("2026-01-01"),
          currentStep: 0,
          workflowDefinition: {
            id: "wf-1",
            name: "Custom Flow",
            companyId: "co-1",
            stepsJson: [{ sequence: 0, approverRules: [{ type: "MANAGER" }], requireAll: false }],
          },
        },
      ]);
      prisma.employee.findUnique.mockResolvedValue({ reportingManagerId: "mgr-1" });
      prisma.assetRequest.findMany.mockResolvedValue([
        { id: "asset-1", status: "PENDING", assetCategory: "LAPTOP", createdAt: new Date("2026-01-04") },
        { id: "asset-2", status: "FULFILLED", assetCategory: "LAPTOP", createdAt: new Date("2026-01-05") },
      ]);

      const items = await workflowService.listMyApprovals(db, "mgr-1", "HR_ADMIN" as never);

      expect(items.map((i) => i.source)).toEqual(expect.arrayContaining(["WORKFLOW", "ASSETS"]));
      // The FULFILLED asset request must be excluded (only PENDING counts).
      expect(items.find((i) => i.id === "asset-2")).toBeUndefined();
    });

    it("never includes asset requests for a Manager — asset approval is HR Admin/Super Admin only", async () => {
      prisma.approvalRequest.findMany.mockResolvedValue([]);
      prisma.assetRequest.findMany.mockResolvedValue([
        { id: "asset-1", status: "PENDING", assetCategory: "LAPTOP", createdAt: new Date() },
      ]);

      const items = await workflowService.listMyApprovals(db, "mgr-1", "MANAGER" as never);

      expect(items.find((i) => i.source === "ASSETS")).toBeUndefined();
      expect(prisma.assetRequest.findMany).not.toHaveBeenCalled();
    });

    it("never includes asset requests for HR Associate either — mirrors HR_ADMIN elsewhere but has no decision authority", async () => {
      prisma.approvalRequest.findMany.mockResolvedValue([]);
      prisma.assetRequest.findMany.mockResolvedValue([
        { id: "asset-1", status: "PENDING", assetCategory: "LAPTOP", createdAt: new Date() },
      ]);

      const items = await workflowService.listMyApprovals(db, "ha-1", "HR_ASSOCIATE" as never);

      expect(items.find((i) => i.source === "ASSETS")).toBeUndefined();
      expect(prisma.assetRequest.findMany).not.toHaveBeenCalled();
    });

    it("only includes ATS requisitions/offers for HR_ADMIN/SUPER_ADMIN or the relevant hiring manager", async () => {
      prisma.approvalRequest.findMany.mockResolvedValue([]);
      prisma.jobRequisition.findMany.mockResolvedValue([{ id: "req-x", title: "Engineer", createdAt: new Date() }]);

      const employeeItems = await workflowService.listMyApprovals(db, "emp-1", "EMPLOYEE" as never);
      expect(employeeItems.find((i) => i.source === "ATS_REQUISITION")).toBeUndefined();

      const hrItems = await workflowService.listMyApprovals(db, "hr-1", "HR_ADMIN" as never);
      expect(hrItems.find((i) => i.source === "ATS_REQUISITION")).toBeDefined();
    });
  });
});
