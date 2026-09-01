import { withRoute } from "@/server/lib/route";
import * as analyticsService from "@/server/modules/analytics/service";

export const GET = withRoute(
  { roles: ["HR_ADMIN", "HR_ASSOCIATE", "SUPER_ADMIN"], module: "ANALYTICS" },
  async () => {
    const result = analyticsService.listReportEntities();
    return Response.json(result);
  },
);
