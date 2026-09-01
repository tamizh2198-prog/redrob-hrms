import { withRoute } from "@/server/lib/route";
import { prisma } from "@/server/lib/prisma";
import { OpenReviewCycleDto } from "@/server/modules/performance/dto";
import * as performanceService from "@/server/modules/performance/service";

export const POST = withRoute(
  { roles: ["HR_ADMIN", "HR_ASSOCIATE", "SUPER_ADMIN"], dto: OpenReviewCycleDto },
  async ({ body }) => {
    const result = await performanceService.openReviewCycle(prisma, body);
    return Response.json(result);
  },
);
