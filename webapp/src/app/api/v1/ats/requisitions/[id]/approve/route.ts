import { withRoute } from "@/server/lib/route";
import { prisma } from "@/server/lib/prisma";
import * as atsService from "@/server/modules/ats/service";

export const POST = withRoute({ roles: ["HR_ADMIN", "SUPER_ADMIN"] }, async ({ user, params }) => {
  const result = await atsService.approveRequisition(prisma, params.id, user!.userId);
  return Response.json(result);
});
