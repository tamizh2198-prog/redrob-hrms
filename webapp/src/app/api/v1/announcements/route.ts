import { withRoute } from "@/server/lib/route";
import { prisma } from "@/server/lib/prisma";
import { CreateAnnouncementDto } from "@/server/modules/announcements/dto";
import * as announcementsService from "@/server/modules/announcements/service";

export const POST = withRoute(
  { roles: ["MANAGER", "HR_ADMIN", "HR_ASSOCIATE", "SUPER_ADMIN"], dto: CreateAnnouncementDto },
  async ({ user, body }) => {
    const result = await announcementsService.createAnnouncement(prisma, body, user!.userId);
    return Response.json(result);
  },
);

export const GET = withRoute({}, async ({ user }) => {
  const result = await announcementsService.listAnnouncements(prisma, user!.userId, user!.role);
  return Response.json(result);
});
