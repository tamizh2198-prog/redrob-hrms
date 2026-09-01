import { withRoute } from "@/server/lib/route";
import { prisma } from "@/server/lib/prisma";
import { ListInboxQueryDto } from "@/server/modules/notifications/dto";
import * as notificationsService from "@/server/modules/notifications/service";

export const GET = withRoute({ query: ListInboxQueryDto }, async ({ user, query }) => {
  const result = await notificationsService.listInbox(prisma, user!.userId, query);
  return Response.json(result);
});
