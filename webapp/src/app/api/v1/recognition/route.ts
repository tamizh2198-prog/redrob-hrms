import { withRoute } from "@/server/lib/route";
import { prisma } from "@/server/lib/prisma";
import { CreateRecognitionDto } from "@/server/modules/announcements/dto";
import * as announcementsService from "@/server/modules/announcements/service";

export const POST = withRoute({ dto: CreateRecognitionDto }, async ({ user, body }) => {
  const result = await announcementsService.createRecognition(prisma, body, user!.userId);
  return Response.json(result);
});
