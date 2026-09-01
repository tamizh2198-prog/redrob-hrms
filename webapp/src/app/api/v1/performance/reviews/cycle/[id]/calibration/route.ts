import { withRoute } from "@/server/lib/route";
import { prisma } from "@/server/lib/prisma";
import * as performanceService from "@/server/modules/performance/service";

export const GET = withRoute({ roles: ["HR_ADMIN", "HR_ASSOCIATE", "SUPER_ADMIN"] }, async ({ params }) => {
  const result = await performanceService.getCalibrationView(prisma, params.id);
  return Response.json(result);
});
