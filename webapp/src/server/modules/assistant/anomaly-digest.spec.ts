import type { PrismaClient } from "@prisma/client";
import * as anomalyDigest from "./anomaly-digest";

jest.mock("../../lib/notify", () => ({ notify: jest.fn().mockResolvedValue(undefined) }));
const { notify } = jest.requireMock("../../lib/notify") as { notify: jest.Mock };

function createMockPrisma() {
  return {
    company: { findMany: jest.fn() },
    employee: { findMany: jest.fn() },
    ticket: { groupBy: jest.fn() },
  };
}

describe("assistant anomaly digest", () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let db: PrismaClient;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma = createMockPrisma();
    db = prisma as unknown as PrismaClient;
    prisma.ticket.groupBy.mockResolvedValue([]);
  });

  it("flags a helpdesk ticket-category spike >= 40%", async () => {
    prisma.ticket.groupBy
      .mockResolvedValueOnce([{ category: "IT_SUPPORT", _count: 14 }])
      .mockResolvedValueOnce([{ category: "IT_SUPPORT", _count: 10 }]);
    const anomalies = await anomalyDigest.computeAnomalies(db, "co-1");
    expect(anomalies.some((a) => a.includes("IT_SUPPORT"))).toBe(true);
  });

  it("sends the digest only to HR_ADMIN/SUPER_ADMIN employees of companies with anomalies", async () => {
    prisma.company.findMany.mockResolvedValue([{ id: "co-1" }, { id: "co-2" }]);
    prisma.ticket.groupBy
      .mockResolvedValueOnce([{ category: "IT_SUPPORT", _count: 14 }])
      .mockResolvedValueOnce([{ category: "IT_SUPPORT", _count: 10 }]) // co-1: spike
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]); // co-2: no data, no anomaly
    prisma.employee.findMany.mockResolvedValue([{ id: "hr-1" }]);

    await anomalyDigest.sendWeeklyAnomalyDigest(db);

    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith(db, expect.objectContaining({ recipientId: "hr-1", template: "assistant.anomaly-digest" }));
  });

  it("sends nothing when no company has any anomaly", async () => {
    prisma.company.findMany.mockResolvedValue([{ id: "co-1" }]);
    await anomalyDigest.sendWeeklyAnomalyDigest(db);
    expect(notify).not.toHaveBeenCalled();
  });
});
