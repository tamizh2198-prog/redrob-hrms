import { withRoute } from "@/server/lib/route";
import { prisma } from "@/server/lib/prisma";
import * as performanceService from "@/server/modules/performance/service";

export const GET = withRoute({}, async ({ user, params }) => {
  const result = await performanceService.listQuarterlyKpiRewards(
    prisma,
    params.employeeId,
    Number(params.year),
    user!.userId,
    user!.role,
  );
  return Response.json(result);
});
