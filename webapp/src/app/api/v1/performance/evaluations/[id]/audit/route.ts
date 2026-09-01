import { withRoute } from "@/server/lib/route";
import { prisma } from "@/server/lib/prisma";
import { AuditMonthlyEvaluationDto } from "@/server/modules/performance/dto";
import * as performanceService from "@/server/modules/performance/service";

export const POST = withRoute({ roles: ["SUPER_ADMIN"], dto: AuditMonthlyEvaluationDto }, async ({ user, params, body }) => {
  const result = await performanceService.auditMonthlyEvaluation(prisma, params.id, body, user!.userId);
  return Response.json(result);
});
