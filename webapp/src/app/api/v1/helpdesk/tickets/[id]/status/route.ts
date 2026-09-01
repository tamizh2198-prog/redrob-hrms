import { withRoute } from "@/server/lib/route";
import { prisma } from "@/server/lib/prisma";
import { UpdateStatusDto } from "@/server/modules/helpdesk/dto";
import * as helpdeskService from "@/server/modules/helpdesk/service";

export const PATCH = withRoute({ dto: UpdateStatusDto }, async ({ user, params, body }) => {
  const result = await helpdeskService.updateStatus(prisma, params.id, body, user!.userId, user!.role);
  return Response.json(result);
});
