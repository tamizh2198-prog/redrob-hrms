import { withRoute } from "@/server/lib/route";
import { prisma } from "@/server/lib/prisma";
import { AssignTicketDto } from "@/server/modules/helpdesk/dto";
import * as helpdeskService from "@/server/modules/helpdesk/service";

export const POST = withRoute(
  { roles: ["HR_ADMIN", "HR_ASSOCIATE", "SUPER_ADMIN"], dto: AssignTicketDto },
  async ({ user, params, body }) => {
    const result = await helpdeskService.assignTicket(prisma, params.id, body, user!.userId);
    return Response.json(result);
  },
);
