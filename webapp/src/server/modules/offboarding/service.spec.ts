import type { PrismaClient } from "@prisma/client";
import { CLEARANCE_ITEMS } from "./service";
import * as offboardingService from "./service";

function createMockPrisma() {
  return {
    employee: { findUnique: jest.fn(), update: jest.fn() },
    resignation: {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
    },
    lwdAdjustment: { create: jest.fn() },
    clearanceItem: {
      findUnique: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
      findMany: jest.fn(),
    },
    exitInterview: { upsert: jest.fn() },
    finalSettlement: {
      findUnique: jest.fn(),
      update: jest.fn(),
      upsert: jest.fn(),
    },
    employeeHistory: { create: jest.fn() },
    $transaction: jest.fn((ops: unknown[]) => Promise.all(ops)),
  };
}

jest.mock("../../lib/notify");
jest.mock("../assets/service", () => ({
  hasUnreturnedAssets: jest.fn(),
  getRecoverableAssetCost: jest.fn(),
}));

describe("offboarding service", () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let db: PrismaClient;
  let assetsService: { hasUnreturnedAssets: jest.Mock; getRecoverableAssetCost: jest.Mock };

  beforeEach(() => {
    jest.clearAllMocks();
    prisma = createMockPrisma();
    db = prisma as unknown as PrismaClient;
    assetsService = jest.requireMock("../assets/service");
  });

  describe("Acceptance Criteria: last working day is correctly computed from the notice period", () => {
    it("computes LWD as submission date + notice period days", async () => {
      prisma.employee.findUnique.mockResolvedValue({ id: "emp-1", reportingManagerId: "mgr-1" });
      prisma.resignation.create.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ id: "res-1", ...data }),
      );

      const result = await offboardingService.submitResignation(db, { noticePeriodDays: 30 } as never, "emp-1", "EMPLOYEE" as never);

      const expectedDays = Math.round(
        (result.lastWorkingDay.getTime() - result.submittedDate.getTime()) / (24 * 60 * 60 * 1000),
      );
      expect(expectedDays).toBe(30);
      expect(prisma.resignation.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            clearanceItems: { create: CLEARANCE_ITEMS.map(({ key, label, category }) => ({ key, label, category })) },
          }),
        }),
      );
    });

    it("rejects an employee submitting a resignation on someone else's behalf", async () => {
      await expect(
        offboardingService.submitResignation(db, { employeeId: "emp-2", noticePeriodDays: 30 } as never, "emp-1", "EMPLOYEE" as never),
      ).rejects.toThrow("Only the employee themselves or HR Admin");
    });

    it("lets HR Associate submit a resignation on an employee's behalf, like HR Admin", async () => {
      prisma.employee.findUnique.mockResolvedValue({ id: "emp-2", reportingManagerId: "mgr-1" });
      prisma.resignation.create.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ id: "res-1", ...data }),
      );

      await expect(
        offboardingService.submitResignation(db, { employeeId: "emp-2", noticePeriodDays: 30 } as never, "ha-1", "HR_ASSOCIATE" as never),
      ).resolves.toBeDefined();
    });
  });

  describe("Acceptance Criteria: the OFFICE_EQUIPMENT checklist item is blocked while unreturned assets exist", () => {
    it("rejects sign-off while the employee still has an unreturned asset", async () => {
      prisma.clearanceItem.findUnique.mockResolvedValue({
        id: "item-1",
        status: "PENDING",
        key: "OFFICE_EQUIPMENT",
        category: "LEAD_VERIFICATION",
        resignationId: "res-1",
        resignation: { employeeId: "emp-1", employee: { reportingManagerId: "mgr-1" } },
      });
      assetsService.hasUnreturnedAssets.mockResolvedValue(true);

      await expect(offboardingService.signoffClearance(db, "item-1", {} as never, "hr-1", "HR_ADMIN" as never)).rejects.toThrow(
        "blocked until every asset",
      );
    });

    it("signs off once all assets are returned", async () => {
      prisma.clearanceItem.findUnique.mockResolvedValue({
        id: "item-1",
        status: "PENDING",
        key: "OFFICE_EQUIPMENT",
        category: "LEAD_VERIFICATION",
        resignationId: "res-1",
        resignation: { employeeId: "emp-1", employee: { reportingManagerId: "mgr-1" } },
      });
      assetsService.hasUnreturnedAssets.mockResolvedValue(false);
      prisma.clearanceItem.update.mockResolvedValue({ id: "item-1", status: "SIGNED_OFF" });
      prisma.clearanceItem.count.mockResolvedValue(3); // other items still pending

      const result = await offboardingService.signoffClearance(db, "item-1", {} as never, "mgr-1", "MANAGER" as never);
      expect(result.status).toBe("SIGNED_OFF");
      expect(prisma.resignation.update).not.toHaveBeenCalled();
    });

    it("flips the resignation to CLEARED once the last item signs off", async () => {
      prisma.clearanceItem.findUnique.mockResolvedValue({
        id: "item-last",
        status: "PENDING",
        key: "TAX_PAPERS",
        category: "EMPLOYEE_DECLARATION",
        resignationId: "res-1",
        resignation: { employeeId: "emp-1", employee: { reportingManagerId: "mgr-1" } },
      });
      prisma.clearanceItem.update.mockResolvedValue({ id: "item-last", status: "SIGNED_OFF" });
      prisma.clearanceItem.count.mockResolvedValue(0);
      prisma.resignation.update.mockResolvedValue({});

      await offboardingService.signoffClearance(db, "item-last", {} as never, "emp-1", "EMPLOYEE" as never);
      expect(prisma.resignation.update).toHaveBeenCalledWith(expect.objectContaining({ data: { status: "CLEARED" } }));
    });
  });

  describe("Acceptance Criteria: clearance checklist RBAC matches the two checklist sections", () => {
    it("rejects a LEAD_VERIFICATION item sign-off from someone who isn't the employee's manager", async () => {
      prisma.clearanceItem.findUnique.mockResolvedValue({
        id: "item-1",
        status: "PENDING",
        key: "ID_CARD",
        category: "LEAD_VERIFICATION",
        resignationId: "res-1",
        resignation: { employeeId: "emp-1", employee: { reportingManagerId: "mgr-real" } },
      });

      await expect(
        offboardingService.signoffClearance(db, "item-1", {} as never, "mgr-imposter", "MANAGER" as never),
      ).rejects.toThrow("Only this employee's manager or HR Admin can verify");
    });

    it("rejects an HR Associate signing off on behalf of the manager — mirrors HR_ADMIN elsewhere but has no sign-off authority", async () => {
      prisma.clearanceItem.findUnique.mockResolvedValue({
        id: "item-1",
        status: "PENDING",
        key: "ID_CARD",
        category: "LEAD_VERIFICATION",
        resignationId: "res-1",
        resignation: { employeeId: "emp-1", employee: { reportingManagerId: "mgr-real" } },
      });

      await expect(
        offboardingService.signoffClearance(db, "item-1", {} as never, "ha-1", "HR_ASSOCIATE" as never),
      ).rejects.toThrow("Only this employee's manager or HR Admin can verify");
    });

    it("rejects an EMPLOYEE_DECLARATION item confirmation from anyone but the exiting employee", async () => {
      prisma.clearanceItem.findUnique.mockResolvedValue({
        id: "item-2",
        status: "PENDING",
        key: "FORWARDING_ADDRESS",
        category: "EMPLOYEE_DECLARATION",
        resignationId: "res-1",
        resignation: { employeeId: "emp-1", employee: { reportingManagerId: "mgr-1" } },
      });

      await expect(
        offboardingService.signoffClearance(db, "item-2", {} as never, "mgr-1", "MANAGER" as never),
      ).rejects.toThrow("Only the exiting employee or HR Admin can confirm");
    });
  });

  describe("Acceptance Criteria: relieving letter generation is blocked until all clearance items are signed off", () => {
    it("rejects letter generation while any checklist item is still pending", async () => {
      prisma.resignation.findUnique.mockResolvedValue({ id: "res-1", employeeId: "emp-1" });
      const items = CLEARANCE_ITEMS.map((i) => ({ ...i, status: "SIGNED_OFF" }));
      items[1].status = "PENDING";
      prisma.clearanceItem.findMany.mockResolvedValue(items);

      await expect(offboardingService.generateLetters(db, "res-1", {} as never, "hr-1")).rejects.toThrow(
        "cannot be generated until every item",
      );
    });

    it("generates both letters and records who released them once every item has signed off", async () => {
      prisma.resignation.findUnique.mockResolvedValue({ id: "res-1", employeeId: "emp-1" });
      prisma.clearanceItem.findMany.mockResolvedValue(CLEARANCE_ITEMS.map((i) => ({ ...i, status: "SIGNED_OFF" })));
      prisma.resignation.update.mockResolvedValue({
        relievingLetterRef: "relieving-letter-res-1.pdf",
        experienceLetterRef: "experience-letter-res-1.pdf",
      });

      const { notify } = jest.requireMock("../../lib/notify");
      const result = await offboardingService.generateLetters(db, "res-1", { closingRemarks: "All clear" } as never, "hr-1");
      expect(result.relievingLetterRef).toBe("relieving-letter-res-1.pdf");
      expect(prisma.resignation.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ certificateReleasedBy: "hr-1", closingRemarks: "All clear" }) }),
      );
      expect(notify).toHaveBeenCalledWith(
        db,
        expect.objectContaining({ recipientId: "emp-1", template: "offboarding.relieving-letter-generated" }),
      );
    });
  });

  describe("Acceptance Criteria: F&F correctly nets notice shortfall and unreturned-asset recovery with no manual re-entry", () => {
    it("pulls asset cost automatically and nets it against notice shortfall (no leave encashment — Leave module removed)", async () => {
      // Notice period was 30 days but the employee actually left 10 days
      // early — a 10-day shortfall.
      const submittedDate = new Date("2027-01-01T00:00:00.000Z");
      const lastWorkingDay = new Date("2027-01-21T00:00:00.000Z"); // 20 days served, not 30
      prisma.resignation.findUnique.mockResolvedValue({ id: "res-1", employeeId: "emp-1", submittedDate, noticePeriodDays: 30, lastWorkingDay });
      assetsService.getRecoverableAssetCost.mockResolvedValue(15000);
      prisma.finalSettlement.upsert.mockImplementation(({ create }: { create: Record<string, unknown> }) => Promise.resolve(create));

      const result = await offboardingService.computeSettlement(db, "res-1", { perDayPayRate: 2000, pendingSalary: 50000 } as never);

      // leaveEncashment = 0 (Leave module removed)
      // noticeRecovery = 10 shortfall days * 2000 = 20000
      // assetRecovery = 15000 (pulled straight from the assets service, untouched)
      // netPayable = 50000 + 0 - 20000 - 15000 = 15000
      expect(result.leaveEncashment).toBe(0);
      expect(result.noticeRecovery).toBe(20000);
      expect(result.assetRecovery).toBe(15000);
      expect(result.netPayable).toBe(15000);
    });

    it("applies zero notice recovery when the employee served the full notice period", async () => {
      const submittedDate = new Date("2027-01-01T00:00:00.000Z");
      const lastWorkingDay = new Date("2027-01-31T00:00:00.000Z"); // full 30 days served
      prisma.resignation.findUnique.mockResolvedValue({ id: "res-1", employeeId: "emp-1", submittedDate, noticePeriodDays: 30, lastWorkingDay });
      assetsService.getRecoverableAssetCost.mockResolvedValue(0);
      prisma.finalSettlement.upsert.mockImplementation(({ create }: { create: Record<string, unknown> }) => Promise.resolve(create));

      const result = await offboardingService.computeSettlement(db, "res-1", { perDayPayRate: 2000 } as never);
      expect(result.noticeRecovery).toBe(0);
    });
  });

  describe("Business Rule: Employee status moves to 'Archived' only after F&F is marked paid", () => {
    it("rejects marking paid before the settlement is approved", async () => {
      prisma.finalSettlement.findUnique.mockResolvedValue({ status: "PENDING_APPROVAL" });

      await expect(offboardingService.markSettlementPaid(db, "res-1", {} as never, "hr-1")).rejects.toThrow(
        "must be approved before it can be marked paid",
      );
      expect(prisma.employee.update).not.toHaveBeenCalled();
    });

    it("archives the employee once the settlement is marked paid", async () => {
      prisma.finalSettlement.findUnique.mockResolvedValue({ status: "APPROVED" });
      prisma.resignation.findUnique.mockResolvedValue({ id: "res-1", employeeId: "emp-1", rehireEligible: true });
      prisma.employee.findUnique.mockResolvedValue({ id: "emp-1", status: "ACTIVE" });

      await offboardingService.markSettlementPaid(db, "res-1", {} as never, "hr-1");

      expect(prisma.employee.update).toHaveBeenCalledWith(expect.objectContaining({ data: { status: "ARCHIVED" } }));
      expect(prisma.employeeHistory.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ oldValue: "ACTIVE", newValue: "ARCHIVED" }) }),
      );
    });
  });

  describe("LWD negotiation audit trail", () => {
    it("rejects an adjustment from someone who isn't the manager or HR", async () => {
      prisma.resignation.findUnique.mockResolvedValue({
        id: "res-1",
        lastWorkingDay: new Date("2027-01-31"),
        employee: { reportingManagerId: "mgr-real" },
      });

      await expect(
        offboardingService.adjustLwd(db, "res-1", { newDate: "2027-01-20", reason: "Early release" } as never, "mgr-imposter", "MANAGER" as never),
      ).rejects.toThrow("Only this employee's manager or HR Admin can adjust");
    });

    it("rejects an HR Associate adjusting the LWD — mirrors HR_ADMIN elsewhere but has no sign-off authority", async () => {
      prisma.resignation.findUnique.mockResolvedValue({
        id: "res-1",
        lastWorkingDay: new Date("2027-01-31"),
        employee: { reportingManagerId: "mgr-real" },
      });

      await expect(
        offboardingService.adjustLwd(db, "res-1", { newDate: "2027-01-20", reason: "Early release" } as never, "ha-1", "HR_ASSOCIATE" as never),
      ).rejects.toThrow("Only this employee's manager or HR Admin can adjust");
    });

    it("records the previous and new date on the audit row when the real manager adjusts it", async () => {
      const previousDate = new Date("2027-01-31T00:00:00.000Z");
      prisma.resignation.findUnique.mockResolvedValue({ id: "res-1", lastWorkingDay: previousDate, employee: { reportingManagerId: "mgr-1" } });
      prisma.resignation.update.mockResolvedValue({ id: "res-1" });

      await offboardingService.adjustLwd(db, "res-1", { newDate: "2027-01-20", reason: "Early release" } as never, "mgr-1", "MANAGER" as never);

      expect(prisma.lwdAdjustment.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ previousDate, reason: "Early release", adjustedBy: "mgr-1" }) }),
      );
    });
  });
});
