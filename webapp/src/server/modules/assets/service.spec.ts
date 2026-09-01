import type { PrismaClient } from "@prisma/client";
import * as assetsService from "./service";

function createMockPrisma() {
  return {
    asset: {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
    },
    assetAssignment: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findFirstOrThrow: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
    assetRequest: {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
    },
    employee: { findUnique: jest.fn(), findMany: jest.fn() },
    $transaction: jest.fn((ops: unknown[]) => Promise.all(ops)),
  };
}

jest.mock("../../lib/notify");
jest.mock("../../lib/default-company", () => ({ getOrCreateDefaultCompanyId: jest.fn().mockResolvedValue("company-1") }));

describe("assets service", () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let db: PrismaClient;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma = createMockPrisma();
    db = prisma as unknown as PrismaClient;
  });

  describe("Acceptance Criteria: an asset cannot show two active custodians simultaneously", () => {
    it("auto-closes the prior custody record when issuing to a new employee", async () => {
      prisma.asset.findUnique.mockResolvedValue({ id: "asset-1" });
      prisma.assetAssignment.findFirst.mockResolvedValue({ id: "assignment-old", employeeId: "emp-old" });
      prisma.assetAssignment.findFirstOrThrow.mockResolvedValue({ id: "assignment-new" });

      await assetsService.issueAsset(db, "asset-1", { employeeId: "emp-new" } as never);

      expect(prisma.assetAssignment.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "assignment-old" },
          data: expect.objectContaining({ returnedAt: expect.any(Date) }),
        }),
      );
      expect(prisma.assetAssignment.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: { assetId: "asset-1", employeeId: "emp-new" } }),
      );
    });

    it("does not attempt to close anything when the asset had no active custodian", async () => {
      prisma.asset.findUnique.mockResolvedValue({ id: "asset-1" });
      prisma.assetAssignment.findFirst.mockResolvedValue(null);
      prisma.assetAssignment.findFirstOrThrow.mockResolvedValue({ id: "assignment-new" });

      await assetsService.issueAsset(db, "asset-1", { employeeId: "emp-new" } as never);

      expect(prisma.assetAssignment.update).not.toHaveBeenCalled();
    });
  });

  describe("Acceptance Criteria: asset issue requires recorded employee acknowledgement", () => {
    it("marks the asset Pending Handover (not Issued) right after issuing", async () => {
      prisma.asset.findUnique.mockResolvedValue({ id: "asset-1" });
      prisma.assetAssignment.findFirst.mockResolvedValue(null);
      prisma.assetAssignment.findFirstOrThrow.mockResolvedValue({ id: "assignment-new" });

      await assetsService.issueAsset(db, "asset-1", { employeeId: "emp-new" } as never);

      expect(prisma.asset.update).toHaveBeenCalledWith(expect.objectContaining({ data: { status: "PENDING_HANDOVER" } }));
    });

    it("rejects acknowledgement from someone other than the receiving employee", async () => {
      prisma.assetAssignment.findUnique.mockResolvedValue({ id: "assignment-1", employeeId: "emp-real", returnedAt: null });

      await expect(assetsService.acknowledgeAsset(db, "assignment-1", "emp-imposter")).rejects.toThrow(
        "Only the receiving employee can acknowledge",
      );
    });

    it("flips the asset to Issued once the receiving employee acknowledges", async () => {
      prisma.assetAssignment.findUnique.mockResolvedValue({
        id: "assignment-1",
        assetId: "asset-1",
        employeeId: "emp-1",
        returnedAt: null,
      });
      prisma.assetAssignment.update.mockResolvedValue({ id: "assignment-1" });
      prisma.asset.update.mockResolvedValue({ id: "asset-1" });

      await assetsService.acknowledgeAsset(db, "assignment-1", "emp-1");

      expect(prisma.asset.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: "asset-1" }, data: { status: "ISSUED" } }),
      );
    });
  });

  describe("Return workflow", () => {
    it("rejects returning an asset with no active custodian", async () => {
      prisma.assetAssignment.findFirst.mockResolvedValue(null);

      await expect(assetsService.returnAsset(db, "asset-1", {} as never)).rejects.toThrow(
        "no active custodian to return from",
      );
    });

    it("returns the asset to the available pool and records the condition", async () => {
      prisma.assetAssignment.findFirst.mockResolvedValue({ id: "assignment-1" });
      prisma.assetAssignment.update.mockResolvedValue({});
      prisma.asset.update.mockResolvedValue({});

      await assetsService.returnAsset(db, "asset-1", { condition: "DAMAGED", remarks: "Cracked screen" } as never);

      expect(prisma.asset.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: "AVAILABLE", condition: "DAMAGED" } }),
      );
    });
  });

  describe("Integration point: offboarding IT clearance / F&F recovery reads", () => {
    it("reports unreturned assets exist", async () => {
      prisma.assetAssignment.count.mockResolvedValue(2);
      await expect(assetsService.hasUnreturnedAssets(db, "emp-1")).resolves.toBe(true);
    });

    it("reports no unreturned assets", async () => {
      prisma.assetAssignment.count.mockResolvedValue(0);
      await expect(assetsService.hasUnreturnedAssets(db, "emp-1")).resolves.toBe(false);
    });

    it("sums the cost of unreturned and damaged assets for recovery", async () => {
      prisma.assetAssignment.findMany.mockResolvedValue([
        { asset: { cost: 50000 } },
        { asset: { cost: 20000 } },
        { asset: { cost: null } },
      ]);

      await expect(assetsService.getRecoverableAssetCost(db, "emp-1")).resolves.toBe(70000);
    });
  });

  describe("Asset requests: approval is HR Admin/Super Admin only", () => {
    it("rejects a decision from an Employee", async () => {
      await expect(assetsService.decideAssetRequest(db, "req-1", true, "someone-else", "EMPLOYEE" as never)).rejects.toThrow(
        "Only HR Admin or Super Admin",
      );
      expect(prisma.assetRequest.findUnique).not.toHaveBeenCalled();
    });

    it("rejects a decision from a Manager, even the requester's own reporting manager", async () => {
      await expect(assetsService.decideAssetRequest(db, "req-1", true, "mgr-1", "MANAGER" as never)).rejects.toThrow(
        "Only HR Admin or Super Admin",
      );
    });

    it("lets HR Admin decide", async () => {
      prisma.assetRequest.findUnique.mockResolvedValue({ id: "req-1", status: "PENDING" });
      prisma.assetRequest.update.mockResolvedValue({ status: "APPROVED" });

      await expect(assetsService.decideAssetRequest(db, "req-1", true, "hr-1", "HR_ADMIN" as never)).resolves.toEqual({
        status: "APPROVED",
      });
    });

    it("lets Super Admin decide", async () => {
      prisma.assetRequest.findUnique.mockResolvedValue({ id: "req-1", status: "PENDING" });
      prisma.assetRequest.update.mockResolvedValue({ status: "REJECTED" });

      await expect(assetsService.decideAssetRequest(db, "req-1", false, "admin-1", "SUPER_ADMIN" as never)).resolves.toEqual({
        status: "REJECTED",
      });
    });

    it("rejects a decision from HR Associate — mirrors HR_ADMIN elsewhere but has no decision authority", async () => {
      await expect(assetsService.decideAssetRequest(db, "req-1", true, "ha-1", "HR_ASSOCIATE" as never)).rejects.toThrow(
        "Only HR Admin or Super Admin",
      );
    });
  });

  describe("Asset requests: HR Associate gets HR_ADMIN-equivalent visibility (not decision authority)", () => {
    it("lets HR Associate see every employee's asset requests, like HR Admin", () => {
      assetsService.listAssetRequests(db, { employeeId: "emp-9" }, { userId: "ha-1", role: "HR_ASSOCIATE" as never });
      expect(prisma.assetRequest.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { employeeId: "emp-9" } }));
    });
  });

  describe("Asset requests: notifies HR Admin/Super Admin, not the reporting manager", () => {
    it("creates the request without an approverId and notifies every HR Admin/Super Admin in the company", async () => {
      prisma.employee.findUnique.mockResolvedValue({ id: "emp-1", companyId: "co-1", reportingManagerId: "mgr-1" });
      prisma.employee.findMany.mockResolvedValue([{ id: "hr-1" }, { id: "admin-1" }]);
      prisma.assetRequest.create.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ id: "req-1", ...data }),
      );

      const { notify } = jest.requireMock("../../lib/notify");
      const result = await assetsService.createAssetRequest(db, { assetCategory: "Laptop" } as never, "emp-1");

      expect(result).not.toHaveProperty("approverId");
      expect(prisma.employee.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { companyId: "co-1", role: { in: ["HR_ADMIN", "SUPER_ADMIN"] } } }),
      );
      expect(notify).toHaveBeenCalledWith(db, expect.objectContaining({ recipientId: "hr-1" }));
      expect(notify).toHaveBeenCalledWith(db, expect.objectContaining({ recipientId: "admin-1" }));
      expect(notify).not.toHaveBeenCalledWith(db, expect.objectContaining({ recipientId: "mgr-1" }));
    });
  });
});
