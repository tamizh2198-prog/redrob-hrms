import type { PrismaClient } from "@prisma/client";
import * as scoreRelease from "./score-release";

jest.mock("../../lib/notify", () => ({ notify: jest.fn().mockResolvedValue(undefined) }));
jest.mock("./service", () => ({ findDueMonthlyReleases: jest.fn().mockResolvedValue([]), markMonthlyReleaseNotified: jest.fn().mockResolvedValue(undefined) }));

const { notify } = jest.requireMock("../../lib/notify") as { notify: jest.Mock };
const { findDueMonthlyReleases, markMonthlyReleaseNotified } = jest.requireMock("./service") as {
  findDueMonthlyReleases: jest.Mock;
  markMonthlyReleaseNotified: jest.Mock;
};

describe("performance score release", () => {
  const db = {} as PrismaClient;

  beforeEach(() => {
    jest.clearAllMocks();
    findDueMonthlyReleases.mockResolvedValue([]);
  });

  it("notifies each due monthly score and marks it notified exactly once", async () => {
    findDueMonthlyReleases.mockResolvedValue([{ id: "eval-1", employeeId: "emp-1", period: new Date("2026-08-01") }]);

    await scoreRelease.releaseDueScores(db);

    expect(notify).toHaveBeenCalledWith(db, expect.objectContaining({ recipientId: "emp-1", template: "performance.monthly-score-released" }));
    expect(markMonthlyReleaseNotified).toHaveBeenCalledWith(db, "eval-1");
  });

  it("does nothing when nothing is due", async () => {
    await scoreRelease.releaseDueScores(db);
    expect(notify).not.toHaveBeenCalled();
  });
});
