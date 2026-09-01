import { withRoute } from "@/server/lib/route";
import { prisma } from "@/server/lib/prisma";
import { AddMessageDto } from "@/server/modules/helpdesk/dto";
import * as helpdeskService from "@/server/modules/helpdesk/service";

export const POST = withRoute({ dto: AddMessageDto }, async ({ user, params, body }) => {
  const result = await helpdeskService.addMessage(prisma, params.id, body, user!.userId, user!.role);
  return Response.json(result);
});
