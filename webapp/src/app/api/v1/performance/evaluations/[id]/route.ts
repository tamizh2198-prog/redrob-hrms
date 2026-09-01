import { withRoute } from "@/server/lib/route";
import { prisma } from "@/server/lib/prisma";
import * as performanceService from "@/server/modules/performance/service";

export const GET = withRoute({}, async ({ user, params }) => {
  const result = await performanceService.getMonthlyEvaluation(prisma, params.id, user!.userId, user!.role);
  return Response.json(result);
});
