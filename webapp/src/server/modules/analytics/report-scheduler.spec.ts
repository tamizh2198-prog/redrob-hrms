import type { PrismaClient } from "@prisma/client";
import * as reportScheduler from "./report-scheduler";

jest.mock("../../lib/notify", () => ({ notify: jest.fn().mockResolvedValue(undefined) }));
jest.mock("./service", () => ({ findDueScheduledReports: jest.fn() }));

const { notify } = jest.requireMock("../../lib/notify") as { notify: jest.Mock };
const { findDueScheduledReports } = jest.requireMock("./service") as { findDueScheduledReports: jest.Mock };

describe("analytics report scheduler", () => {
  const db = {} as PrismaClient;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("sends one notification per re-validated recipient, not per original recipient", async () => {
    findDueScheduledReports.mockResolvedValue([
      { savedReportId: "sr-1", name: "Weekly headcount", total: 42, recipientCount: 3, validRecipientIds: ["hr-1"] },
    ]);

    await reportScheduler.sendDueScheduledReports(db);

    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith(db, {
      recipientId: "hr-1",
      template: "analytics.saved-report-ready",
      body: 'Your scheduled report "Weekly headcount" is ready (42 records).',
      data: { savedReportId: "sr-1", name: "Weekly headcount", total: 42 },
    });
  });

  it("sends nothing when no reports are due", async () => {
    findDueScheduledReports.mockResolvedValue([]);
    await reportScheduler.sendDueScheduledReports(db);
    expect(notify).not.toHaveBeenCalled();
  });

  it("never throws even when every recipient was dropped by the RBAC re-check", async () => {
    findDueScheduledReports.mockResolvedValue([
      { savedReportId: "sr-1", name: "Weekly headcount", total: 5, recipientCount: 2, validRecipientIds: [] },
    ]);

    await expect(reportScheduler.sendDueScheduledReports(db)).resolves.not.toThrow();
    expect(notify).not.toHaveBeenCalled();
  });
});
