import { withRoute } from "@/server/lib/route";
import { prisma } from "@/server/lib/prisma";
import * as announcementsService from "@/server/modules/announcements/service";

export const GET = withRoute({}, async ({ user }) => {
  const result = await announcementsService.listRecognitionFeed(prisma, user!.userId, user!.role);
  return Response.json(result);
});
