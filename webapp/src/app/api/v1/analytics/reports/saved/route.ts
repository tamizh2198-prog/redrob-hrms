import { withRoute } from "@/server/lib/route";
import { prisma } from "@/server/lib/prisma";
import { CreateSavedReportDto } from "@/server/modules/analytics/dto";
import * as analyticsService from "@/server/modules/analytics/service";

export const POST = withRoute(
  { roles: ["HR_ADMIN", "HR_ASSOCIATE", "SUPER_ADMIN"], module: "ANALYTICS", dto: CreateSavedReportDto },
  async ({ user, body }) => {
    const result = await analyticsService.createSavedReport(prisma, body, user!.userId);
    return Response.json(result);
  },
);

export const GET = withRoute(
  { roles: ["HR_ADMIN", "HR_ASSOCIATE", "SUPER_ADMIN"], module: "ANALYTICS" },
  async () => {
    const result = await analyticsService.listSavedReports(prisma);
    return Response.json(result);
  },
);
