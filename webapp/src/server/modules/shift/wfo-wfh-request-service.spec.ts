import type { PrismaClient } from "@prisma/client";
import * as wfoWfhService from "./wfo-wfh-request-service";

jest.mock("../../lib/notify");
jest.mock("../../lib/request-comments");

function createMockPrisma() {
  return {
    wfoWfhChangeRequest: { findMany: jest.fn() },
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
