import { withRoute } from "@/server/lib/route";
import { prisma } from "@/server/lib/prisma";
import { GrantModuleAccessDto } from "@/server/modules/module-access/dto";
import * as moduleAccessService from "@/server/modules/module-access/service";

export const POST = withRoute({ roles: ["SUPER_ADMIN"], dto: GrantModuleAccessDto }, async ({ user, body }) => {
  const result = await moduleAccessService.grant(prisma, body.employeeId, body.module, user!.userId);
  return Response.json(result);
});
