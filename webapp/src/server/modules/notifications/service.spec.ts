import type { PrismaClient } from "@prisma/client";
import * as notificationsService from "./service";

jest.mock("../../lib/email");

function createMockPrisma() {
  return {
    employee: { findUnique: jest.fn() },
    notification: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      count: jest.fn(),
    },
    notificationPreference: { findUnique: jest.fn(), findMany: jest.fn(), upsert: jest.fn() },
    notificationLog: { createMany: jest.fn(), findMany: jest.fn() },
  };
}

describe("notifications service", () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let db: PrismaClient;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma = createMockPrisma();
    db = prisma as unknown as PrismaClient;
    jest.requireMock("../../lib/email").sendEmail.mockResolvedValue({ sent: true });
  });

  describe("the real implementation behind notify()", () => {
    it("is a no-op when the recipient does not resolve to a real employee", async () => {
      prisma.employee.findUnique.mockResolvedValue(null);

      await notificationsService.dispatch(db, {
        recipientId: "hr-admin",
        template: "helpdesk.ticket-created",
        body: "A new ticket was created.",
      });

      expect(prisma.notification.create).not.toHaveBeenCalled();
      expect(prisma.notificationLog.createMany).not.toHaveBeenCalled();
    });

    it("creates an in-app notification, sends a real email, and simulates SLACK/SMS on a non-critical template", async () => {
      prisma.employee.findUnique.mockResolvedValue({ id: "emp-1", companyId: "company-1", workEmail: "emp1@co.com" });
      prisma.notificationPreference.findUnique.mockResolvedValue(null);

      await notificationsService.dispatch(db, {
        recipientId: "emp-1",
        template: "leave.decision-made",
        body: "Your leave application was approved.",
        data: { approved: true },
      });

      expect(prisma.notification.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ employeeId: "emp-1", template: "leave.decision-made" }) }),
      );
      expect(prisma.notificationLog.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.arrayContaining([
            expect.objectContaining({ channel: "EMAIL", status: "SENT" }),
            expect.objectContaining({ channel: "SLACK" }),
            expect.objectContaining({ channel: "SMS" }),
          ]),
        }),
      );
      // EMAIL is now real for every category when enabled, not just the 3
      // critical templates — only SLACK/SMS remain simulated (no integration
      // exists yet).
      expect(jest.requireMock("../../lib/email").sendEmail).toHaveBeenCalledWith(
        expect.objectContaining({ to: "emp1@co.com" }),
      );
    });

    it("does not send an email for a non-critical template when the employee disabled EMAIL", async () => {
      prisma.employee.findUnique.mockResolvedValue({ id: "emp-1", companyId: "company-1", workEmail: "emp1@co.com" });
      prisma.notificationPreference.findUnique.mockResolvedValue({ channelsEnabled: ["IN_APP"] });

      await notificationsService.dispatch(db, {
        recipientId: "emp-1",
        template: "leave.decision-made",
        body: "Your leave application was approved.",
      });

      expect(jest.requireMock("../../lib/email").sendEmail).not.toHaveBeenCalled();
    });

    it("respects a per-employee channel opt-out and skips the in-app row when IN_APP is disabled", async () => {
      prisma.employee.findUnique.mockResolvedValue({ id: "emp-1", companyId: "company-1" });
      prisma.notificationPreference.findUnique.mockResolvedValue({ channelsEnabled: ["EMAIL"] });

      await notificationsService.dispatch(db, {
        recipientId: "emp-1",
        template: "leave.decision-made",
        body: "Your leave application was approved.",
      });

      expect(prisma.notification.create).not.toHaveBeenCalled();
      expect(prisma.notificationLog.createMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: [expect.objectContaining({ channel: "EMAIL" })] }),
      );
    });

    it("always forces EMAIL for a critical template even if the employee opted out of every channel", async () => {
      prisma.employee.findUnique.mockResolvedValue({ id: "emp-1", companyId: "company-1", workEmail: "emp1@co.com" });
      prisma.notificationPreference.findUnique.mockResolvedValue({ channelsEnabled: ["IN_APP"] });

      await notificationsService.dispatch(db, {
        recipientId: "emp-1",
        template: "auth.password-reset",
        body: "Your password reset was requested.",
      });

      expect(prisma.notificationLog.createMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: [expect.objectContaining({ channel: "EMAIL", status: "SENT" })] }),
      );
    });

    describe("real email delivery for the 3 critical categories", () => {
      it("sends a real email via sendEmail for a critical template and logs SENT on success", async () => {
        prisma.employee.findUnique.mockResolvedValue({ id: "emp-1", companyId: "company-1", workEmail: "emp1@co.com" });
        prisma.notificationPreference.findUnique.mockResolvedValue(null);

        await notificationsService.dispatch(db, {
          recipientId: "emp-1",
          template: "auth.mfa-reset",
          body: "Your MFA was reset by an HR Admin/Super Admin.",
        });

        expect(jest.requireMock("../../lib/email").sendEmail).toHaveBeenCalledWith(
          expect.objectContaining({
            to: "emp1@co.com",
            subject: "Redrob HRMS: auth mfa reset",
            text: "Your MFA was reset by an HR Admin/Super Admin.",
          }),
        );
        expect(prisma.notificationLog.createMany).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.arrayContaining([expect.objectContaining({ channel: "EMAIL", status: "SENT" })]),
          }),
        );
      });

      it("logs FAILED when sendEmail reports it could not send", async () => {
        prisma.employee.findUnique.mockResolvedValue({ id: "emp-1", companyId: "company-1", workEmail: "emp1@co.com" });
        prisma.notificationPreference.findUnique.mockResolvedValue(null);
        jest.requireMock("../../lib/email").sendEmail.mockResolvedValue({ sent: false });

        await notificationsService.dispatch(db, {
          recipientId: "emp-1",
          template: "auth.permission-changed",
          body: "Your role was changed.",
        });

        expect(prisma.notificationLog.createMany).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.arrayContaining([expect.objectContaining({ channel: "EMAIL", status: "FAILED" })]),
          }),
        );
      });

      it("skips sending and logs SKIPPED when the employee has no work email on file", async () => {
        prisma.employee.findUnique.mockResolvedValue({ id: "emp-1", companyId: "company-1", workEmail: null });
        prisma.notificationPreference.findUnique.mockResolvedValue(null);

        await notificationsService.dispatch(db, {
          recipientId: "emp-1",
          template: "auth.password-reset",
          body: "A password reset was requested for your account.",
        });

        expect(jest.requireMock("../../lib/email").sendEmail).not.toHaveBeenCalled();
        expect(prisma.notificationLog.createMany).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.arrayContaining([expect.objectContaining({ channel: "EMAIL", status: "SKIPPED" })]),
          }),
        );
      });
    });
  });

  describe("inbox", () => {
    it("scopes listInbox to the requesting employee and reports the unread count", async () => {
      prisma.notification.findMany.mockResolvedValue([]);
      prisma.notification.count.mockResolvedValueOnce(0).mockResolvedValueOnce(3);

      const result = await notificationsService.listInbox(db, "emp-1", {});

      expect(prisma.notification.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { employeeId: "emp-1" } }));
      expect(result.unreadCount).toBe(3);
    });

    it("rejects marking another employee's notification as read", async () => {
      prisma.notification.findUnique.mockResolvedValue({ id: "notif-1", employeeId: "someone-else", readAt: null });

      await expect(notificationsService.markRead(db, "notif-1", "emp-1")).rejects.toThrow(
        "Not authorized to modify this notification",
      );
    });

    it("throws NotFoundError for a notification that does not exist", async () => {
      prisma.notification.findUnique.mockResolvedValue(null);

      await expect(notificationsService.markRead(db, "missing", "emp-1")).rejects.toThrow("Notification not found");
    });

    it("is idempotent when marking an already-read notification as read", async () => {
      const existing = { id: "notif-1", employeeId: "emp-1", readAt: new Date() };
      prisma.notification.findUnique.mockResolvedValue(existing);

      const result = await notificationsService.markRead(db, "notif-1", "emp-1");

      expect(result).toBe(existing);
      expect(prisma.notification.update).not.toHaveBeenCalled();
    });
  });

  describe("preferences", () => {
    it("defaults every category to all channels enabled when no preference rows exist", async () => {
      prisma.notificationPreference.findMany.mockResolvedValue([]);

      const result = await notificationsService.getPreferences(db, "emp-1");

      expect(result.find((r) => r.eventCategory === "ASSETS")?.channelsEnabled).toEqual(["IN_APP", "EMAIL", "SLACK", "SMS"]);
    });

    it("upserts a preference row for the given employee/category", async () => {
      await notificationsService.updatePreferences(db, "emp-1", { eventCategory: "LEAVE", channelsEnabled: ["IN_APP"] } as never);

      expect(prisma.notificationPreference.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ where: { employeeId_eventCategory: { employeeId: "emp-1", eventCategory: "LEAVE" } } }),
      );
    });
  });

  describe("Reports: delivery volume/success-failure by channel", () => {
    it("aggregates NotificationLog rows by template and channel", async () => {
      prisma.notificationLog.findMany.mockResolvedValue([
        { template: "leave.decision-made", channel: "EMAIL", status: "SENT" },
        { template: "leave.decision-made", channel: "SLACK", status: "FAILED" },
      ]);
      prisma.notification.count.mockResolvedValue(5);

      const report = await notificationsService.getDeliveryReport(db);

      expect(report.volumeByTemplate["leave.decision-made"]).toBe(2);
      expect(report.byChannel.EMAIL).toEqual({ sent: 1, failed: 0 });
      expect(report.byChannel.SLACK).toEqual({ sent: 0, failed: 1 });
      expect(report.inAppCount).toBe(5);
    });
  });
});
