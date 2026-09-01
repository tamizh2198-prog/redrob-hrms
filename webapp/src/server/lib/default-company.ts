import type { PrismaClient } from "@prisma/client";

export async function getOrCreateDefaultCompanyId(prisma: PrismaClient): Promise<string> {
  const existing = await prisma.company.findFirst();
  if (existing) return existing.id;
  const created = await prisma.company.create({ data: { name: "Default Company" } });
  return created.id;
}
