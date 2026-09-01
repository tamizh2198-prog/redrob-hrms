import { withRoute } from "@/server/lib/route";
import { prisma } from "@/server/lib/prisma";
import * as settingsService from "@/server/modules/settings/service";

export const GET = withRoute({ roles: ["HR_ADMIN", "HR_ASSOCIATE", "SUPER_ADMIN"] }, async () => {
  const result = await settingsService.listOrgStructure(prisma);
  return Response.json(result);
});
