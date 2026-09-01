import type { PrismaClient } from "@prisma/client";
import * as auditService from "./service";

function createMockPrisma() {
  return {
    auditLog: { findMany: jest.fn(), count: jest.fn() },
  };
}

describe("audit service", () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let db: PrismaClient;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma = createMockPrisma();
    db = prisma as unknown as PrismaClient;
  });

  describe("listAuditLogs filters", () => {
    it("filters by module, actor, and date range together", async () => {
      prisma.auditLog.findMany.mockResolvedValue([]);
      prisma.auditLog.count.mockResolvedValue(0);

      await auditService.listAuditLogs(db, {
        module: "settings",
        actorId: "emp-1",
        dateFrom: "2026-01-01",
        dateTo: "2026-01-31",
      });

      expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            module: "settings",
            actorId: "emp-1",
            createdAt: { gte: new Date("2026-01-01"), lte: new Date("2026-01-31") },
          },
        }),
      );
    });

    it("returns an unfiltered where clause when no filters are supplied", async () => {
      prisma.auditLog.findMany.mockResolvedValue([]);
      prisma.auditLog.count.mockResolvedValue(0);

      await auditService.listAuditLogs(db, {});

      expect(prisma.auditLog.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {} }));
    });
  });

  describe("exportAuditLogs", () => {
    it("applies the same filters as listAuditLogs but caps rows instead of paginating", async () => {
      prisma.auditLog.findMany.mockResolvedValue([{ id: "log-1" }]);

      const result = await auditService.exportAuditLogs(db, { module: "audit" });

      expect(prisma.auditLog.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { module: "audit" }, take: 5000 }));
      expect(result.total).toBe(1);
    });
  });
});
