import { withRoute } from "@/server/lib/route";
import { prisma } from "@/server/lib/prisma";
import * as notificationsService from "@/server/modules/notifications/service";

export const PATCH = withRoute({}, async ({ user }) => {
  const result = await notificationsService.markAllRead(prisma, user!.userId);
  return Response.json(result);
});
