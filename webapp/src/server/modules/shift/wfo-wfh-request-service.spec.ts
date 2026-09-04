import type { PrismaClient } from "@prisma/client";
import * as wfoWfhService from "./wfo-wfh-request-service";

jest.mock("../../lib/notify");
jest.mock("../../lib/request-comments");

function createMockPrisma() {
  return {
    wfoWfhChangeRequest: { findMany: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
    employee: { findMany: jest.fn() },
  };
}

// The requesting employee's own view, the Super Admin/HR "all requests" view,
// and both manager-facing queues previously never showed who the assigned
// manager/approver was — approverId is a loose string, not a Prisma
// relation, so it can't be resolved via `include`. This covers the manual
// lookup added to fix that.
describe("WFO/WFH requests: approver name resolution", () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let db: PrismaClient;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma = createMockPrisma();
    db = prisma as unknown as PrismaClient;
  });

  it("attaches the assigned manager's name to the requester's own list", async () => {
    prisma.wfoWfhChangeRequest.findMany.mockResolvedValue([
      { id: "req-1", employeeId: "emp-1", approverId: "mgr-1" },
    ]);
    prisma.employee.findMany.mockResolvedValue([{ id: "mgr-1", firstName: "Priya", lastName: "Rao" }]);

    const [result] = await wfoWfhService.listMine(db, "emp-1");

    expect(prisma.employee.findMany).toHaveBeenCalledWith({
      where: { id: { in: ["mgr-1"] } },
      select: { id: true, firstName: true, lastName: true },
    });
    expect(result.approverName).toBe("Priya Rao");
  });

  it("does not query for names when no request has an approver assigned", async () => {
    prisma.wfoWfhChangeRequest.findMany.mockResolvedValue([{ id: "req-1", employeeId: "emp-1", approverId: null }]);

    const [result] = await wfoWfhService.listMine(db, "emp-1");

    expect(prisma.employee.findMany).not.toHaveBeenCalled();
    expect(result.approverName).toBeNull();
  });

  it("resolves distinct approver names across a mixed list (Super Admin's all-requests view)", async () => {
    prisma.wfoWfhChangeRequest.findMany.mockResolvedValue([
      { id: "req-1", employeeId: "emp-1", approverId: "mgr-1", employee: {} },
      { id: "req-2", employeeId: "emp-2", approverId: "mgr-2", employee: {} },
      { id: "req-3", employeeId: "emp-3", approverId: "mgr-1", employee: {} },
    ]);
    prisma.employee.findMany.mockResolvedValue([
      { id: "mgr-1", firstName: "Priya", lastName: "Rao" },
      { id: "mgr-2", firstName: "Amit", lastName: "Shah" },
    ]);

    const results = await wfoWfhService.listAll(db);

    expect(prisma.employee.findMany).toHaveBeenCalledTimes(1);
    expect(results.map((r) => r.approverName)).toEqual(["Priya Rao", "Amit Shah", "Priya Rao"]);
  });
});

// The manager stage of a WFO/WFH request must be decided by the employee's
// actual manager (approverId) only — a Super Admin/HR Admin who isn't that
// manager should be limited to visibility (the pending-manager-stage list),
// not decision authority. Previously any HR_ADMIN/SUPER_ADMIN could decide
// any manager-stage request regardless of whether they were the assignee.
describe("WFO/WFH requests: manager-stage decision is scoped to the assigned approver", () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let db: PrismaClient;

  const baseRequest = {
    id: "req-1",
    employeeId: "emp-1",
    approverId: "mgr-1",
    status: "PENDING_MANAGER",
    requestedWorkMode: "WORK_FROM_HOME",
    originalDate: new Date("2026-01-05"),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    prisma = createMockPrisma();
    db = prisma as unknown as PrismaClient;
    prisma.employee.findMany.mockResolvedValue([]);
  });

  it("lets the assigned manager decide, regardless of their role", async () => {
    prisma.wfoWfhChangeRequest.findUnique.mockResolvedValue(baseRequest);
    prisma.wfoWfhChangeRequest.update.mockResolvedValue({});

    await expect(
      wfoWfhService.decide(db, "req-1", "mgr-1", { approve: true }, "MANAGER" as never),
    ).resolves.toEqual({ status: "PENDING_FINAL_APPROVAL" });
  });

  it("rejects a Super Admin who is not the assigned manager", async () => {
    prisma.wfoWfhChangeRequest.findUnique.mockResolvedValue(baseRequest);

    await expect(
      wfoWfhService.decide(db, "req-1", "super-admin-1", { approve: true }, "SUPER_ADMIN" as never),
    ).rejects.toThrow("Only the employee's assigned manager can decide this request");
    expect(prisma.wfoWfhChangeRequest.update).not.toHaveBeenCalled();
  });

  it("rejects an HR Admin who is not the assigned manager", async () => {
    prisma.wfoWfhChangeRequest.findUnique.mockResolvedValue(baseRequest);

    await expect(
      wfoWfhService.decide(db, "req-1", "hr-admin-1", { approve: true }, "HR_ADMIN" as never),
    ).rejects.toThrow("Only the employee's assigned manager can decide this request");
    expect(prisma.wfoWfhChangeRequest.update).not.toHaveBeenCalled();
  });

  it("lets a Super Admin decide when they are themselves the assigned approver (e.g. the no-manager fallback)", async () => {
    prisma.wfoWfhChangeRequest.findUnique.mockResolvedValue({ ...baseRequest, approverId: "super-admin-1" });
    prisma.wfoWfhChangeRequest.update.mockResolvedValue({});

    await expect(
      wfoWfhService.decide(db, "req-1", "super-admin-1", { approve: true }, "SUPER_ADMIN" as never),
    ).resolves.toEqual({ status: "PENDING_FINAL_APPROVAL" });
  });
});
