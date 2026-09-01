import { withRoute } from "@/server/lib/route";
import { prisma } from "@/server/lib/prisma";
import * as helpdeskService from "@/server/modules/helpdesk/service";

export const GET = withRoute({ roles: ["HR_ADMIN", "HR_ASSOCIATE", "SUPER_ADMIN"] }, async () => {
  const result = await helpdeskService.getDashboardSummary(prisma);
  return Response.json(result);
});
