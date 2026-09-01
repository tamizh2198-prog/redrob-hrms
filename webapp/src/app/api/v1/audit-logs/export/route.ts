import { withRoute } from "@/server/lib/route";
import { prisma } from "@/server/lib/prisma";
import { ListAuditLogsQueryDto } from "@/server/modules/audit/dto";
import * as auditService from "@/server/modules/audit/service";
import { toCsv } from "@/server/modules/analytics/report-export.util";

export const GET = withRoute({ roles: ["HR_ADMIN", "HR_ASSOCIATE", "SUPER_ADMIN"], query: ListAuditLogsQueryDto }, async ({ query }) => {
  const { rows } = await auditService.exportAuditLogs(prisma, query);
  const csv = toCsv({ entity: "AuditLog", total: rows.length, rows: rows as ({ id: string } & Record<string, unknown>)[] });
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": 'attachment; filename="audit-logs.csv"',
    },
  });
});
