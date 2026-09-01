import type { PrismaClient } from "@prisma/client";
import { BadRequestError } from "../../lib/errors";
import * as permissionsService from "./service";

function createMockPrisma() {
  return {
    permission: { findMany: jest.fn() },
    rolePermission: { findMany: jest.fn(), count: jest.fn(), deleteMany: jest.fn(), createMany: jest.fn() },
    $transaction: jest.fn((ops: unknown[]) => Promise.all(ops)),
  };
}

describe("permissions service", () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let db: PrismaClient;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma = createMockPrisma();
    db = prisma as unknown as PrismaClient;
    prisma.$transaction.mockImplementation((ops: unknown[]) => Promise.all(ops));
  });

  describe("listRoles", () => {
    it("returns all existing Role enum values, unmodified", () => {
      const result = permissionsService.listRoles();
      expect(result).toEqual([
        { role: "EMPLOYEE" },
        { role: "MANAGER" },
        { role: "HR_ADMIN" },
        { role: "SUPER_ADMIN" },
        { role: "HR_ASSOCIATE" },
      ]);
    });
  });

  describe("listPermissions", () => {
    it("delegates to prisma.permission.findMany", async () => {
      prisma.permission.findMany.mockResolvedValue([{ id: "p-1", key: "employee.view" }]);
      const result = await permissionsService.listPermissions(db);
      expect(result).toEqual([{ id: "p-1", key: "employee.view" }]);
      expect(prisma.permission.findMany).toHaveBeenCalled();
    });
  });

  describe("getRolePermissions", () => {
    it("marks catalog permissions as enabled/disabled for the given role", async () => {
      prisma.permission.findMany.mockResolvedValue([
        { id: "p-1", key: "employee.view" },
        { id: "p-2", key: "employee.delete" },
      ]);
      prisma.rolePermission.findMany.mockResolvedValue([{ permissionId: "p-1" }]);

      const result = await permissionsService.getRolePermissions(db, "MANAGER");

      expect(result.role).toBe("MANAGER");
      expect(result.editable).toBe(true);
      expect(result.permissions).toEqual([
        { id: "p-1", key: "employee.view", enabled: true },
        { id: "p-2", key: "employee.delete", enabled: false },
      ]);
    });

    it("marks SUPER_ADMIN as not editable", async () => {
      prisma.permission.findMany.mockResolvedValue([]);
      prisma.rolePermission.findMany.mockResolvedValue([]);
      const result = await permissionsService.getRolePermissions(db, "SUPER_ADMIN");
      expect(result.editable).toBe(false);
    });

    it("rejects an unknown role string", async () => {
      await expect(permissionsService.getRolePermissions(db, "NOT_A_ROLE")).rejects.toThrow(BadRequestError);
    });
  });

  describe("updateRolePermissions — security", () => {
    it("rejects any attempt to modify SUPER_ADMIN permissions", async () => {
      await expect(permissionsService.updateRolePermissions(db, "SUPER_ADMIN", { permissionIds: ["p-1"] })).rejects.toThrow(BadRequestError);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it("rejects an invalid role parameter", async () => {
      await expect(permissionsService.updateRolePermissions(db, "LEADERSHIP", { permissionIds: [] })).rejects.toThrow(BadRequestError);
    });

    it("rejects permission ids that do not exist in the catalog", async () => {
      prisma.permission.findMany.mockResolvedValue([{ id: "p-1" }]);
      await expect(
        permissionsService.updateRolePermissions(db, "HR_ADMIN", { permissionIds: ["p-1", "fake-id-does-not-exist"] }),
      ).rejects.toThrow(BadRequestError);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe("updateRolePermissions — happy path", () => {
    it("replaces the role permission set inside a transaction", async () => {
      prisma.permission.findMany
        .mockResolvedValueOnce([{ id: "p-1" }, { id: "p-2" }]) // existence check
        .mockResolvedValueOnce([
          { id: "p-1", key: "employee.view" },
          { id: "p-2", key: "leave.view" },
        ]); // getRolePermissions catalog
      prisma.rolePermission.findMany.mockResolvedValue([{ permissionId: "p-1" }, { permissionId: "p-2" }]);

      const result = await permissionsService.updateRolePermissions(db, "MANAGER", { permissionIds: ["p-1", "p-2"] });

      expect(prisma.rolePermission.deleteMany).toHaveBeenCalledWith({ where: { role: "MANAGER" } });
      expect(prisma.rolePermission.createMany).toHaveBeenCalledWith({
        data: [
          { role: "MANAGER", permissionId: "p-1" },
          { role: "MANAGER", permissionId: "p-2" },
        ],
      });
      expect(result.role).toBe("MANAGER");
    });

    it("deduplicates repeated permission ids in the request body", async () => {
      prisma.permission.findMany.mockResolvedValueOnce([{ id: "p-1" }]).mockResolvedValueOnce([]);
      prisma.rolePermission.findMany.mockResolvedValue([]);

      await permissionsService.updateRolePermissions(db, "EMPLOYEE", { permissionIds: ["p-1", "p-1", "p-1"] });

      expect(prisma.rolePermission.createMany).toHaveBeenCalledWith({ data: [{ role: "EMPLOYEE", permissionId: "p-1" }] });
    });
  });
});
