import { withRoute } from "@/server/lib/route";
import { prisma } from "@/server/lib/prisma";
import * as analyticsService from "@/server/modules/analytics/service";

export const GET = withRoute({}, async ({ user }) => {
  const result = await analyticsService.getDashboard(prisma, user!.userId, user!.role);
  return Response.json(result);
});
