import { withRoute } from "@/server/lib/route";
import { prisma } from "@/server/lib/prisma";
import { UpdateGoalProgressDto } from "@/server/modules/performance/dto";
import * as performanceService from "@/server/modules/performance/service";

export const PATCH = withRoute({ dto: UpdateGoalProgressDto }, async ({ user, params, body }) => {
  const result = await performanceService.updateGoalProgress(prisma, params.id, body.actual, user!.userId, user!.role);
  return Response.json(result);
});
