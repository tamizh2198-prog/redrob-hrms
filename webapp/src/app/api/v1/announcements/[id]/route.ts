import { withRoute } from "@/server/lib/route";
import { prisma } from "@/server/lib/prisma";
import * as announcementsService from "@/server/modules/announcements/service";

export const GET = withRoute({}, async ({ user, params }) => {
  const result = await announcementsService.getAnnouncement(prisma, params.id, user!.userId, user!.role);
  return Response.json(result);
});
