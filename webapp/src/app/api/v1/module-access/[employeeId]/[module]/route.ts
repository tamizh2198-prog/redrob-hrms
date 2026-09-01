import { withRoute } from "@/server/lib/route";
import { prisma } from "@/server/lib/prisma";
import * as moduleAccessService from "@/server/modules/module-access/service";

export const DELETE = withRoute({ roles: ["SUPER_ADMIN"] }, async ({ params }) => {
  const result = await moduleAccessService.revoke(prisma, params.employeeId, params.module);
  return Response.json(result);
});
