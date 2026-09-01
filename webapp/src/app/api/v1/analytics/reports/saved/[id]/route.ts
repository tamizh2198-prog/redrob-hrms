import { withRoute } from "@/server/lib/route";
import { prisma } from "@/server/lib/prisma";
import * as analyticsService from "@/server/modules/analytics/service";

export const DELETE = withRoute(
  { roles: ["HR_ADMIN", "HR_ASSOCIATE", "SUPER_ADMIN"], module: "ANALYTICS" },
  async ({ params }) => {
    await analyticsService.deleteSavedReport(prisma, params.id);
    return Response.json({ success: true });
  },
);
