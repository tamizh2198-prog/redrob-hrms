import { withRoute } from "@/server/lib/route";
import { prisma } from "@/server/lib/prisma";
import * as announcementsService from "@/server/modules/announcements/service";

export const POST = withRoute({}, async ({ user, params }) => {
  const result = await announcementsService.ackAnnouncement(prisma, params.id, user!.userId);
  return Response.json(result);
});
