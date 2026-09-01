import { withRoute } from "@/server/lib/route";
import { prisma } from "@/server/lib/prisma";
import * as performanceService from "@/server/modules/performance/service";

export const GET = withRoute({}, async () => {
  const result = await performanceService.listReviewCycles(prisma);
  return Response.json(result);
});
