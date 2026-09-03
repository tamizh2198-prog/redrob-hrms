import type { PrismaClient } from "@prisma/client";
import { assertCanAccessEmployeeData, isPrivilegedRole } from "./reporting-hierarchy";

function createMockPrisma() {
  return {
    employee: { findMany: jest.fn().mockResolvedValue([]) },
  };
}

describe("isPrivilegedRole", () => {
  it("treats HR_ADMIN, HR_ASSOCIATE, and SUPER_ADMIN as privileged", () => {
    expect(isPrivilegedRole("HR_ADMIN" as never)).toBe(true);
    expect(isPrivilegedRole("HR_ASSOCIATE" as never)).toBe(true);
    expect(isPrivilegedRole("SUPER_ADMIN" as never)).toBe(true);
  });

  it("does not treat EMPLOYEE or MANAGER as privileged", () => {
    expect(isPrivilegedRole("EMPLOYEE" as never)).toBe(false);
    expect(isPrivilegedRole("MANAGER" as never)).toBe(false);
    expect(isPrivilegedRole(undefined)).toBe(false);
  });
});

// HRMS-21 regression test: assertCanAccessEmployeeData used to grant access
// to HR_ADMIN/SUPER_ADMIN only, while employee/service.ts's own
// isPrivilegedRole granted the same set plus HR_ASSOCIATE — the same role
// saw unmasked PII through one path and a ForbiddenError through another.
// Both now share isPrivilegedRole above, so this asserts they agree.
describe("assertCanAccessEmployeeData", () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let db: PrismaClient;

  beforeEach(() => {
    prisma = createMockPrisma();
    db = prisma as unknown as PrismaClient;
  });

  it("allows HR_ASSOCIATE to access an arbitrary employee's data, matching HR_ADMIN", async () => {
    await expect(
      assertCanAccessEmployeeData(db, "emp-target", { userId: "ha-1", role: "HR_ASSOCIATE" as never }),
    ).resolves.toBeUndefined();
  });

  it("allows HR_ADMIN and SUPER_ADMIN to access an arbitrary employee's data", async () => {
    await expect(
      assertCanAccessEmployeeData(db, "emp-target", { userId: "hr-1", role: "HR_ADMIN" as never }),
    ).resolves.toBeUndefined();
    await expect(
      assertCanAccessEmployeeData(db, "emp-target", { userId: "sa-1", role: "SUPER_ADMIN" as never }),
    ).resolves.toBeUndefined();
  });

  it("allows an employee to access their own data", async () => {
    await expect(
      assertCanAccessEmployeeData(db, "emp-1", { userId: "emp-1", role: "EMPLOYEE" as never }),
    ).resolves.toBeUndefined();
  });

  it("allows a manager to access a direct report's data", async () => {
    prisma.employee.findMany.mockResolvedValueOnce([{ id: "emp-1" }]).mockResolvedValueOnce([]);
    await expect(
      assertCanAccessEmployeeData(db, "emp-1", { userId: "mgr-1", role: "MANAGER" as never }),
    ).resolves.toBeUndefined();
  });

  it("rejects an ordinary employee accessing someone else's data", async () => {
    await expect(
      assertCanAccessEmployeeData(db, "emp-2", { userId: "emp-1", role: "EMPLOYEE" as never }),
    ).rejects.toThrow("Not authorized to access this employee's data");
  });

  it("rejects a manager accessing an employee outside their reporting tree", async () => {
    prisma.employee.findMany.mockResolvedValue([]);
    await expect(
      assertCanAccessEmployeeData(db, "emp-99", { userId: "mgr-1", role: "MANAGER" as never }),
    ).rejects.toThrow("Not authorized to access this employee's data");
  });
});
