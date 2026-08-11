import { PrismaService } from '../database/prisma.service';

// Full downward reporting tree (direct + indirect reports), not just direct
// reports — shared by Analytics (Section 7.13) and Assistant (Section 7.14)
// manager-scoped queries so neither has to re-derive it.
export async function getReportingHierarchyIds(
  prisma: PrismaService,
  managerId: string,
): Promise<string[]> {
  const all: string[] = [];
  let frontier = [managerId];
  while (frontier.length > 0) {
    const directs = await prisma.employee.findMany({
      where: { reportingManagerId: { in: frontier } },
      select: { id: true },
    });
    const ids = directs.map((d) => d.id);
    all.push(...ids);
    frontier = ids;
  }
  return all;
}
