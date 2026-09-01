import type { PrismaClient } from "@prisma/client";
import { BadRequestError, NotFoundError } from "../../lib/errors";
import { GRANTABLE_MODULES, type GrantableModule } from "./constants";

export function listModules() {
  return GRANTABLE_MODULES;
}

export async function grant(prisma: PrismaClient, employeeId: string, module: GrantableModule, actorId: string) {
  const employee = await prisma.employee.findUnique({ where: { id: employeeId } });
  if (!employee) throw new NotFoundError("Employee not found");

  return prisma.moduleAccessGrant.upsert({
    where: { employeeId_module: { employeeId, module } },
    // Already granted — re-granting is a no-op on the grant itself, but
    // still worth recording who most recently confirmed it.
    update: { grantedBy: actorId },
    create: { employeeId, module, grantedBy: actorId },
  });
}

export async function revoke(prisma: PrismaClient, employeeId: string, module: string) {
  if (!GRANTABLE_MODULES.includes(module as GrantableModule)) {
    throw new BadRequestError(`Unknown module: ${module}`);
  }
  await prisma.moduleAccessGrant.deleteMany({ where: { employeeId, module } });
  return { revoked: true };
}

export function listForEmployee(prisma: PrismaClient, employeeId: string) {
  return prisma.moduleAccessGrant.findMany({ where: { employeeId }, orderBy: { module: "asc" } });
}
