import { withRoute } from "@/server/lib/route";
import { prisma } from "@/server/lib/prisma";
import * as learningService from "@/server/modules/learning/service";

export const GET = withRoute({ roles: ["SUPER_ADMIN"] }, async () => {
  const result = await learningService.listAllSpendLimits(prisma);
  return Response.json(result);
});
