import { withRoute } from "@/server/lib/route";
import { prisma } from "@/server/lib/prisma";
import * as helpdeskService from "@/server/modules/helpdesk/service";

export const GET = withRoute({}, async ({ user, params }) => {
  const result = await helpdeskService.getTicket(prisma, params.id, user!.userId, user!.role);
  return Response.json(result);
});
