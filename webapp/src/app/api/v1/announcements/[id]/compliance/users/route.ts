import { withRoute } from "@/server/lib/route";
import { prisma } from "@/server/lib/prisma";
import * as announcementsService from "@/server/modules/announcements/service";

export const GET = withRoute({ roles: ["HR_ADMIN", "HR_ASSOCIATE", "SUPER_ADMIN"] }, async ({ params }) => {
  const result = await announcementsService.getComplianceUsers(prisma, params.id);
  return Response.json(result);
});
