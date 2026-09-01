import type { Prisma, PrismaClient } from "@prisma/client";
import type { ListAuditLogsQueryDto } from "./dto";

function buildWhere(query: ListAuditLogsQueryDto): Prisma.AuditLogWhereInput {
  return {
    ...(query.module && { module: query.module }),
    ...(query.actorId && { actorId: query.actorId }),
    ...((query.dateFrom || query.dateTo) && {
      createdAt: {
        ...(query.dateFrom && { gte: new Date(query.dateFrom) }),
        ...(query.dateTo && { lte: new Date(query.dateTo) }),
      },
    }),
  };
}

export async function listAuditLogs(prisma: PrismaClient, query: ListAuditLogsQueryDto) {
  const page = query.page ?? 1;
  const pageSize = query.pageSize ?? 20;
  const where = buildWhere(query);

  const [items, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      skip: (page - 1) * pageSize,
      take: pageSize,
      orderBy: { createdAt: "desc" },
    }),
    prisma.auditLog.count({ where }),
  ]);

  return { items, total, page, pageSize };
}

// Same filters as listAuditLogs, no pagination, capped so an unbounded date
// range can't blow up memory (a real system would stream this; hand-rolled
// CSV keeps this build dependency-free, same approach as Analytics'
// report-export.util.ts).
export async function exportAuditLogs(prisma: PrismaClient, query: ListAuditLogsQueryDto) {
  const rows = await prisma.auditLog.findMany({
    where: buildWhere(query),
    orderBy: { createdAt: "desc" },
    take: 5000,
  });
  return { rows, total: rows.length };
}
