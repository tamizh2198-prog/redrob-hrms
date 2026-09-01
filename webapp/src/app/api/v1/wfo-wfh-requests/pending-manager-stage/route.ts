import { withRoute } from "@/server/lib/route";
import { prisma } from "@/server/lib/prisma";
import * as wfoWfhService from "@/server/modules/shift/wfo-wfh-request-service";

export const GET = withRoute({ roles: ["HR_ADMIN", "HR_ASSOCIATE", "SUPER_ADMIN"], module: "SHIFT" }, async () => {
  const result = await wfoWfhService.listPendingManagerStageForVisibility(prisma);
  return Response.json(result);
});
