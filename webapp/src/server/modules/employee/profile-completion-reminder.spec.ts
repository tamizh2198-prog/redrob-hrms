import type { PrismaClient } from "@prisma/client";
import * as profileCompletionReminder from "./profile-completion-reminder";

jest.mock("../../lib/notify", () => ({ notify: jest.fn().mockResolvedValue(undefined) }));
const { notify } = jest.requireMock("../../lib/notify") as { notify: jest.Mock };

const ALL_REQUIRED_FILLED = {
  dob: new Date("1990-01-01"),
  gender: "MALE",
  phone: "9999999999",
  addressLine: "123 Main St",
  city: "Bengaluru",
  state: "Karnataka",
  postalCode: "560001",
  pan: "ABCDE1234F",
  bankAccountNumber: "000111222333",
  emergencyContactName: "John Doe",
  emergencyContactPhone: "8888888888",
};

function makeEmployee(overrides: Record<string, unknown> = {}) {
  return {
    id: "emp-1",
    companyId: "company-1",
    firstName: "Jane",
    lastName: "Doe",
    dob: null,
    gender: null,
    phone: null,
    addressLine: null,
    city: null,
    state: null,
    country: null,
    postalCode: null,
    pan: null,
    aadhaar: null,
    bankAccountNumber: null,
    emergencyContactName: null,
    emergencyContactPhone: null,
    personalEmail: null,
    ...overrides,
  };
}

function createMockPrisma() {
  return { employee: { findMany: jest.fn() } };
}

describe("employee profile completion reminder", () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let db: PrismaClient;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma = createMockPrisma();
    db = prisma as unknown as PrismaClient;
  });

  it("notifies both the employee and every HR Admin when a profile is still incomplete 24h after joining", async () => {
    prisma.employee.findMany.mockResolvedValueOnce([makeEmployee()]).mockResolvedValueOnce([{ id: "hr-1" }, { id: "hr-2" }]);

    await profileCompletionReminder.remindIncompleteProfiles(db);

    expect(notify).toHaveBeenCalledWith(db, expect.objectContaining({ recipientId: "emp-1", template: "profile-completion.reminder" }));
    expect(notify).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ recipientId: "hr-1", template: "profile-completion.reminder", data: { employeeId: "emp-1" } }),
    );
    expect(notify).toHaveBeenCalledWith(db, expect.objectContaining({ recipientId: "hr-2" }));
    expect(notify).toHaveBeenCalledTimes(3);
    expect(prisma.employee.findMany).toHaveBeenNthCalledWith(2, { where: { companyId: "company-1", role: "HR_ADMIN" }, select: { id: true } });
  });

  it("sends nothing for an employee whose profile is already complete", async () => {
    prisma.employee.findMany.mockResolvedValueOnce([makeEmployee(ALL_REQUIRED_FILLED)]);

    await profileCompletionReminder.remindIncompleteProfiles(db);

    expect(notify).not.toHaveBeenCalled();
    expect(prisma.employee.findMany).toHaveBeenCalledTimes(1);
  });

  it("sends nothing when no employee falls in the 24h reminder window", async () => {
    prisma.employee.findMany.mockResolvedValueOnce([]);

    await profileCompletionReminder.remindIncompleteProfiles(db);

    expect(notify).not.toHaveBeenCalled();
  });
});
