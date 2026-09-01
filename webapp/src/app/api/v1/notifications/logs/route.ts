import { withRoute } from "@/server/lib/route";
import { prisma } from "@/server/lib/prisma";
import * as notificationsService from "@/server/modules/notifications/service";

export const GET = withRoute({ roles: ["HR_ADMIN", "SUPER_ADMIN"] }, async () => {
  const result = await notificationsService.getDeliveryReport(prisma);
  return Response.json(result);
});
