import { withRoute } from "@/server/lib/route";
import { prisma } from "@/server/lib/prisma";
import { UpdatePreferencesDto } from "@/server/modules/notifications/dto";
import * as notificationsService from "@/server/modules/notifications/service";

export const GET = withRoute({}, async ({ user }) => {
  const result = await notificationsService.getPreferences(prisma, user!.userId);
  return Response.json(result);
});

export const PATCH = withRoute({ dto: UpdatePreferencesDto }, async ({ user, body }) => {
  const result = await notificationsService.updatePreferences(prisma, user!.userId, body);
  return Response.json(result);
});
