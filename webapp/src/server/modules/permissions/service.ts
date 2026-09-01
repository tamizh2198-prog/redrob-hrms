import { Role, type PrismaClient } from "@prisma/client";
import { BadRequestError } from "../../lib/errors";
import type { UpdateRolePermissionsDto } from "./dto";

const ALL_ROLES = Object.values(Role);

function assertValidRole(role: string): Role {
  if (!ALL_ROLES.includes(role as Role)) {
    throw new BadRequestError(`Unknown role: ${role}`);
  }
  return role as Role;
}

export function listRoles() {
  return ALL_ROLES.map((role) => ({ role }));
}

export function listPermissions(prisma: PrismaClient) {
  return prisma.permission.findMany({ orderBy: [{ category: "asc" }, { name: "asc" }] });
}

export async function getRolePermissions(prisma: PrismaClient, roleParam: string) {
  const role = assertValidRole(roleParam);

  const [permissions, rolePermissions] = await Promise.all([
    listPermissions(prisma),
    prisma.rolePermission.findMany({ where: { role } }),
  ]);
  const enabledIds = new Set(rolePermissions.map((rp) => rp.permissionId));
  return {
    role,
    editable: role !== "SUPER_ADMIN",
    permissions: permissions.map((p) => ({ ...p, enabled: enabledIds.has(p.id) })),
  };
}

// SUPER_ADMIN's permission set is not editable through this API. Every
// existing module's authorization still runs through role checks in
// withRoute(), not this catalog, so unchecking a box here would not
// actually restrict Super Admin access — it would only mislead whoever is
// looking at the UI. Blocking the write outright keeps the catalog honest
// about what it currently controls.
export async function updateRolePermissions(prisma: PrismaClient, roleParam: string, dto: UpdateRolePermissionsDto) {
  const role = assertValidRole(roleParam);
  if (role === "SUPER_ADMIN") {
    throw new BadRequestError("SUPER_ADMIN permissions cannot be modified");
  }

  const uniqueIds = Array.from(new Set(dto.permissionIds));
  if (uniqueIds.length > 0) {
    const found = await prisma.permission.findMany({ where: { id: { in: uniqueIds } }, select: { id: true } });
    if (found.length !== uniqueIds.length) {
      throw new BadRequestError("One or more permission ids do not exist");
    }
  }

  await prisma.$transaction([
    prisma.rolePermission.deleteMany({ where: { role } }),
    prisma.rolePermission.createMany({ data: uniqueIds.map((permissionId) => ({ role, permissionId })) }),
  ]);

  return getRolePermissions(prisma, role);
}
