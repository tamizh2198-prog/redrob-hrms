import { withRoute } from "@/server/lib/route";
import { prisma } from "@/server/lib/prisma";
import * as moduleAccessService from "@/server/modules/module-access/service";

export const GET = withRoute({ roles: ["SUPER_ADMIN"] }, async ({ params }) => {
  const result = await moduleAccessService.listForEmployee(prisma, params.employeeId);
  return Response.json(result);
});
