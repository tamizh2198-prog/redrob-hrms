import { withRoute } from "@/server/lib/route";
import { prisma } from "@/server/lib/prisma";
import { ListAuditLogsQueryDto } from "@/server/modules/audit/dto";
import * as auditService from "@/server/modules/audit/service";

export const GET = withRoute({ roles: ["HR_ADMIN", "HR_ASSOCIATE", "SUPER_ADMIN"], query: ListAuditLogsQueryDto }, async ({ query }) => {
  const result = await auditService.listAuditLogs(prisma, query);
  return Response.json(result);
});
