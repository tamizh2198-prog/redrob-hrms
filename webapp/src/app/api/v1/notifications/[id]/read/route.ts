import { withRoute } from "@/server/lib/route";
import { prisma } from "@/server/lib/prisma";
import * as notificationsService from "@/server/modules/notifications/service";

export const PATCH = withRoute({}, async ({ user, params }) => {
  const result = await notificationsService.markRead(prisma, params.id, user!.userId);
  return Response.json(result);
});
