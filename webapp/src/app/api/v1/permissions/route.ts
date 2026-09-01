import { withRoute } from "@/server/lib/route";
import { prisma } from "@/server/lib/prisma";
import * as permissionsService from "@/server/modules/permissions/service";

export const GET = withRoute({ roles: ["SUPER_ADMIN"] }, async () => {
  const result = await permissionsService.listPermissions(prisma);
  return Response.json(result);
});
