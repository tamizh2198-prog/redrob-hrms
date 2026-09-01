import { withRoute } from "@/server/lib/route";
import { prisma } from "@/server/lib/prisma";
import * as atsService from "@/server/modules/ats/service";

export const POST = withRoute({ roles: ["HR_ADMIN", "HR_ASSOCIATE", "SUPER_ADMIN"] }, async ({ params }) => {
  const result = await atsService.publishRequisition(prisma, params.id);
  return Response.json(result);
});
