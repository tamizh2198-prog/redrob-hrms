import type { PrismaClient } from "@prisma/client";
import { BadRequestError, NotFoundError } from "../../lib/errors";
import * as settingsService from "./service";

jest.mock("../../lib/default-company", () => ({
  getOrCreateDefaultCompanyId: jest.fn().mockResolvedValue("company-1"),
}));

function createMockPrisma() {
  return {
    companySettings: { findUnique: jest.fn(), create: jest.fn(), upsert: jest.fn() },
    department: { findMany: jest.fn(), create: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
    location: { findMany: jest.fn(), create: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
    designation: { findMany: jest.fn(), create: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
    grade: { findMany: jest.fn(), create: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
    integrationConfig: { findMany: jest.fn(), upsert: jest.fn() },
  };
}

describe("settings service", () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let db: PrismaClient;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma = createMockPrisma();
    db = prisma as unknown as PrismaClient;
  });

  describe("Data Entities: CompanySettings", () => {
    it("creates a default row with sane defaults on first read", async () => {
      prisma.companySettings.findUnique.mockResolvedValue(null);
      prisma.companySettings.create.mockResolvedValue({ companyId: "company-1" });

      await settingsService.getCompanySettings(db);

      expect(prisma.companySettings.create).toHaveBeenCalledWith({ data: { companyId: "company-1" } });
    });

    it("does not recreate an existing row", async () => {
      const existing = { companyId: "company-1", timezone: "Asia/Kolkata" };
      prisma.companySettings.findUnique.mockResolvedValue(existing);

      const result = await settingsService.getCompanySettings(db);

      expect(result).toBe(existing);
      expect(prisma.companySettings.create).not.toHaveBeenCalled();
    });
  });

  describe("org structure", () => {
    it("rejects an unknown org unit type", async () => {
      await expect(settingsService.createOrgUnit(db, "bogus", { name: "X", code: "X" })).rejects.toThrow(BadRequestError);
    });

    it("dispatches department creation to the Department delegate", async () => {
      prisma.department.create.mockResolvedValue({ id: "dept-1" });

      await settingsService.createOrgUnit(db, "department", { name: "Engineering", code: "ENG", parentId: "parent-1" });

      expect(prisma.department.create).toHaveBeenCalledWith({
        data: { companyId: "company-1", name: "Engineering", code: "ENG", parentId: "parent-1" },
      });
    });

    it("ignores parentId for non-department types", async () => {
      prisma.location.create.mockResolvedValue({ id: "loc-1" });

      await settingsService.createOrgUnit(db, "location", { name: "Chennai", code: "MAA", parentId: "should-be-ignored" });

      expect(prisma.location.create).toHaveBeenCalledWith({ data: { companyId: "company-1", name: "Chennai", code: "MAA" } });
    });

    it("throws NotFoundError when updating a unit that does not exist", async () => {
      prisma.grade.findUnique.mockResolvedValue(null);

      await expect(settingsService.updateOrgUnit(db, "grade", "missing", { isActive: false })).rejects.toThrow(NotFoundError);
    });

    describe("Business Rule: deactivating a unit with active employees requires explicit confirmation", () => {
      it("rejects deactivation without force when employees are still assigned", async () => {
        prisma.designation.findUnique.mockResolvedValue({ isActive: true, employees: [{ id: "emp-1" }] });

        await expect(settingsService.updateOrgUnit(db, "designation", "des-1", { isActive: false })).rejects.toThrow(BadRequestError);
        expect(prisma.designation.update).not.toHaveBeenCalled();
      });

      it("allows deactivation with force even when employees are still assigned", async () => {
        prisma.designation.findUnique.mockResolvedValue({ isActive: true, employees: [{ id: "emp-1" }] });
        prisma.designation.update.mockResolvedValue({ id: "des-1", isActive: false });

        await settingsService.updateOrgUnit(db, "designation", "des-1", { isActive: false, force: true });

        expect(prisma.designation.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ isActive: false }) }));
      });

      it("allows deactivation without force when no employees are assigned", async () => {
        prisma.location.findUnique.mockResolvedValue({ isActive: true, employees: [] });
        prisma.location.update.mockResolvedValue({ id: "loc-1", isActive: false });

        await settingsService.updateOrgUnit(db, "location", "loc-1", { isActive: false });

        expect(prisma.location.update).toHaveBeenCalled();
      });
    });
  });

  describe("Data Entities: IntegrationConfig", () => {
    it("surfaces every integration type even before any row exists", async () => {
      prisma.integrationConfig.findMany.mockResolvedValue([]);

      const result = await settingsService.listIntegrations(db);

      expect(result.length).toBeGreaterThan(0);
      expect(result.every((r) => r.status === "NOT_CONFIGURED")).toBe(true);
    });

    it("rejects an unknown integration type", async () => {
      await expect(settingsService.updateIntegration(db, "BOGUS", { status: "CONFIGURED" as never })).rejects.toThrow(BadRequestError);
    });

    it("upserts status/metadata for a known integration type", async () => {
      prisma.integrationConfig.upsert.mockResolvedValue({ type: "SLACK", status: "CONFIGURED" });

      await settingsService.updateIntegration(db, "SLACK", { status: "CONFIGURED" as never, metadata: { webhookUrl: "https://example.test/hook" } });

      expect(prisma.integrationConfig.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ where: { companyId_type: { companyId: "company-1", type: "SLACK" } } }),
      );
    });
  });
});
