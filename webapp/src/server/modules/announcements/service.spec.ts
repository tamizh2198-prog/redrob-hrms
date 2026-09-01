import type { PrismaClient } from "@prisma/client";
import * as announcementsService from "./service";

function createMockPrisma() {
  return {
    employee: { findUnique: jest.fn(), findMany: jest.fn() },
    announcement: { create: jest.fn(), findUnique: jest.fn(), findMany: jest.fn() },
    announcementAck: { findUnique: jest.fn(), update: jest.fn(), count: jest.fn(), findMany: jest.fn() },
    recognition: { create: jest.fn(), findMany: jest.fn() },
  };
}

jest.mock("../../lib/notify");

describe("announcements service", () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let db: PrismaClient;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma = createMockPrisma();
    db = prisma as unknown as PrismaClient;
  });

  describe("Key Feature: target employees by organization, department, or location", () => {
    it("rejects a DEPARTMENT-scoped announcement with no departmentId", async () => {
      prisma.employee.findUnique.mockResolvedValue({ id: "hr-1", companyId: "co-1" });

      await expect(
        announcementsService.createAnnouncement(db, { title: "t", body: "b", scope: "DEPARTMENT" } as never, "hr-1"),
      ).rejects.toThrow("departmentId is required");
    });

    it("rejects a LOCATION-scoped announcement with no locationId", async () => {
      prisma.employee.findUnique.mockResolvedValue({ id: "hr-1", companyId: "co-1" });

      await expect(
        announcementsService.createAnnouncement(db, { title: "t", body: "b", scope: "LOCATION" } as never, "hr-1"),
      ).rejects.toThrow("locationId is required");
    });

    it("creates one AnnouncementAck per targeted employee when requiresAck is true", async () => {
      prisma.employee.findUnique.mockResolvedValue({ id: "hr-1", companyId: "co-1" });
      prisma.employee.findMany.mockResolvedValue([{ id: "emp-1" }, { id: "emp-2" }]);
      prisma.announcement.create.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ id: "ann-1", ...data }),
      );

      const { notify } = jest.requireMock("../../lib/notify");
      await announcementsService.createAnnouncement(
        db,
        { title: "t", body: "b", scope: "ORGANIZATION", requiresAck: true } as never,
        "hr-1",
      );

      expect(prisma.announcement.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ acks: { create: [{ employeeId: "emp-1" }, { employeeId: "emp-2" }] } }),
        }),
      );
      expect(notify).toHaveBeenCalledTimes(2);
    });

    it("does not create ack rows when requiresAck is false", async () => {
      prisma.employee.findUnique.mockResolvedValue({ id: "hr-1", companyId: "co-1" });
      prisma.employee.findMany.mockResolvedValue([{ id: "emp-1" }]);
      prisma.announcement.create.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ id: "ann-1", ...data }),
      );

      await announcementsService.createAnnouncement(db, { title: "t", body: "b", scope: "ORGANIZATION" } as never, "hr-1");

      expect(prisma.announcement.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.not.objectContaining({ acks: expect.anything() }) }),
      );
    });
  });

  describe("Acceptance Criteria: targeted announcements are visible only to the intended scope", () => {
    it("scopes a non-privileged actor to ORGANIZATION-wide plus their own department/location", async () => {
      prisma.employee.findUnique.mockResolvedValue({ id: "emp-1", companyId: "co-1", departmentId: "dept-1", locationId: "loc-1" });
      prisma.announcement.findMany.mockResolvedValue([]);

      await announcementsService.listAnnouncements(db, "emp-1", "EMPLOYEE" as never);

      expect(prisma.announcement.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            companyId: "co-1",
            OR: [
              { scope: "ORGANIZATION" },
              { scope: "DEPARTMENT", departmentId: "dept-1" },
              { scope: "LOCATION", locationId: "loc-1" },
            ],
          }),
        }),
      );
    });

    it("lets HR Admin see every announcement in the company with no scope filter", async () => {
      prisma.employee.findUnique.mockResolvedValue({ id: "hr-1", companyId: "co-1" });
      prisma.announcement.findMany.mockResolvedValue([]);

      await announcementsService.listAnnouncements(db, "hr-1", "HR_ADMIN" as never);

      expect(prisma.announcement.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { companyId: "co-1" } }));
    });

    it("lets HR Associate see every announcement too, like HR Admin", async () => {
      prisma.employee.findUnique.mockResolvedValue({ id: "ha-1", companyId: "co-1" });
      prisma.announcement.findMany.mockResolvedValue([]);

      await announcementsService.listAnnouncements(db, "ha-1", "HR_ASSOCIATE" as never);

      expect(prisma.announcement.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { companyId: "co-1" } }));
    });

    it("rejects viewing a DEPARTMENT-scoped announcement from outside that department", async () => {
      prisma.announcement.findUnique.mockResolvedValue({ id: "ann-1", scope: "DEPARTMENT", departmentId: "dept-1", locationId: null });
      prisma.employee.findUnique.mockResolvedValue({ id: "emp-2", departmentId: "dept-2", locationId: null });

      await expect(announcementsService.getAnnouncement(db, "ann-1", "emp-2", "EMPLOYEE" as never)).rejects.toThrow(
        "outside your visibility scope",
      );
    });

    it("allows HR Admin to view any announcement regardless of scope", async () => {
      prisma.announcement.findUnique.mockResolvedValue({ id: "ann-1", scope: "DEPARTMENT", departmentId: "dept-1", locationId: null });
      prisma.employee.findUnique.mockResolvedValue({ id: "hr-1", departmentId: null, locationId: null });

      await expect(announcementsService.getAnnouncement(db, "ann-1", "hr-1", "HR_ADMIN" as never)).resolves.toBeDefined();
    });
  });

  describe("Business Rule: only a targeted employee can acknowledge an announcement", () => {
    it("rejects acknowledging an announcement with no Ack row for this employee", async () => {
      prisma.announcementAck.findUnique.mockResolvedValue(null);

      await expect(announcementsService.ackAnnouncement(db, "ann-1", "emp-1")).rejects.toThrow(
        "was not found or does not target you",
      );
    });

    it("is idempotent for an already-acknowledged ack", async () => {
      const existing = { id: "ack-1", acknowledgedAt: new Date("2026-01-01") };
      prisma.announcementAck.findUnique.mockResolvedValue(existing);

      const result = await announcementsService.ackAnnouncement(db, "ann-1", "emp-1");
      expect(result).toBe(existing);
      expect(prisma.announcementAck.update).not.toHaveBeenCalled();
    });

    it("sets acknowledgedAt on first acknowledgement", async () => {
      prisma.announcementAck.findUnique.mockResolvedValue({ id: "ack-1", acknowledgedAt: null });
      prisma.announcementAck.update.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ id: "ack-1", ...data }),
      );

      const result = await announcementsService.ackAnnouncement(db, "ann-1", "emp-1");
      expect(result.acknowledgedAt).toBeInstanceOf(Date);
    });
  });

  describe("Acceptance Criteria: mandatory announcement compliance accurately reflects per-employee read status", () => {
    it("computes totalTargeted/acknowledged/pending/compliancePercentage exactly", async () => {
      prisma.announcement.findUnique.mockResolvedValue({ id: "ann-1" });
      prisma.announcementAck.count.mockResolvedValueOnce(10).mockResolvedValueOnce(7);

      const result = await announcementsService.getCompliance(db, "ann-1");
      expect(result).toEqual({ totalTargeted: 10, acknowledged: 7, pending: 3, compliancePercentage: 70 });
    });

    it("reports 100% compliance when nobody was targeted", async () => {
      prisma.announcement.findUnique.mockResolvedValue({ id: "ann-1" });
      prisma.announcementAck.count.mockResolvedValueOnce(0).mockResolvedValueOnce(0);

      const result = await announcementsService.getCompliance(db, "ann-1");
      expect(result.compliancePercentage).toBe(100);
    });

    it("rejects computing compliance for a non-existent announcement", async () => {
      prisma.announcement.findUnique.mockResolvedValue(null);

      await expect(announcementsService.getCompliance(db, "missing")).rejects.toThrow("Announcement not found");
    });

    it("lists per-employee ack status for HR Admin", async () => {
      prisma.announcement.findUnique.mockResolvedValue({ id: "ann-1" });
      prisma.announcementAck.findMany.mockResolvedValue([
        { employee: { id: "emp-1", employeeCode: "E1", firstName: "A", lastName: "B" }, acknowledgedAt: new Date() },
        { employee: { id: "emp-2", employeeCode: "E2", firstName: "C", lastName: "D" }, acknowledgedAt: null },
      ]);

      const result = await announcementsService.getComplianceUsers(db, "ann-1");
      expect(result).toEqual([
        expect.objectContaining({ employeeId: "emp-1", acknowledged: true }),
        expect.objectContaining({ employeeId: "emp-2", acknowledged: false }),
      ]);
    });
  });

  describe("Business Rule: mandatory unread reminder at T+2 days", () => {
    it("marks remindedAt for unacknowledged acks past the window and returns them", async () => {
      prisma.announcementAck.findMany.mockResolvedValue([
        { id: "ack-1", employeeId: "emp-1", announcementId: "ann-1", announcement: { id: "ann-1" } },
      ]);
      prisma.announcementAck.update.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ id: "ack-1", employeeId: "emp-1", announcementId: "ann-1", ...data }),
      );

      const result = await announcementsService.findDueReminders(db);
      expect(result).toHaveLength(1);
      expect(prisma.announcementAck.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { remindedAt: expect.any(Date) } }),
      );
    });

    it("only queries acks that are unacknowledged, unreminded, and past T+2", async () => {
      prisma.announcementAck.findMany.mockResolvedValue([]);

      await announcementsService.findDueReminders(db);

      expect(prisma.announcementAck.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ acknowledgedAt: null, remindedAt: null, announcement: { createdAt: { lte: expect.any(Date) } } }),
        }),
      );
    });
  });

  describe("Business Rule: recognition notifies the recipient and, if one exists, their manager", () => {
    it("rejects sending recognition to yourself", async () => {
      await expect(
        announcementsService.createRecognition(db, { recipientId: "emp-1", message: "nice", category: "TEAMWORK" } as never, "emp-1"),
      ).rejects.toThrow("cannot send recognition to yourself");
    });

    it("notifies both the recipient and their manager when one exists", async () => {
      prisma.employee.findUnique.mockResolvedValue({ id: "emp-2", reportingManagerId: "mgr-1" });
      prisma.recognition.create.mockResolvedValue({ id: "rec-1" });

      const { notify } = jest.requireMock("../../lib/notify");
      await announcementsService.createRecognition(
        db,
        { recipientId: "emp-2", message: "great job", category: "INNOVATION" } as never,
        "emp-1",
      );

      expect(notify).toHaveBeenCalledWith(db, expect.objectContaining({ recipientId: "emp-2", template: "recognition.received" }));
      expect(notify).toHaveBeenCalledWith(db, expect.objectContaining({ recipientId: "mgr-1", template: "recognition.manager-notified" }));
    });

    it("notifies only the recipient when they have no manager", async () => {
      prisma.employee.findUnique.mockResolvedValue({ id: "emp-2", reportingManagerId: null });
      prisma.recognition.create.mockResolvedValue({ id: "rec-1" });

      const { notify } = jest.requireMock("../../lib/notify");
      await announcementsService.createRecognition(
        db,
        { recipientId: "emp-2", message: "great job", category: "CUSTOMER_FOCUS" } as never,
        "emp-1",
      );

      expect(notify).toHaveBeenCalledTimes(1);
    });
  });

  describe("Key Feature: recognition can optionally be restricted to a department", () => {
    it("scopes a non-privileged viewer to public entries plus their own department", async () => {
      prisma.employee.findUnique.mockResolvedValue({ id: "emp-1", departmentId: "dept-1" });
      prisma.recognition.findMany.mockResolvedValue([]);

      await announcementsService.listRecognitionFeed(db, "emp-1", "EMPLOYEE" as never);

      expect(prisma.recognition.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { OR: [{ departmentId: null }, { departmentId: "dept-1" }] } }),
      );
    });

    it("shows HR Admin every recognition with no restriction", async () => {
      prisma.employee.findUnique.mockResolvedValue({ id: "hr-1", departmentId: null });
      prisma.recognition.findMany.mockResolvedValue([]);

      await announcementsService.listRecognitionFeed(db, "hr-1", "HR_ADMIN" as never);

      expect(prisma.recognition.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {} }));
    });
  });
});
