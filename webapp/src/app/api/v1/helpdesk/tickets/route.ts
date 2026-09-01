import { withRoute } from "@/server/lib/route";
import { prisma } from "@/server/lib/prisma";
import { CreateTicketDto, ListTicketsQueryDto } from "@/server/modules/helpdesk/dto";
import * as helpdeskService from "@/server/modules/helpdesk/service";

export const POST = withRoute({ dto: CreateTicketDto }, async ({ user, body }) => {
  const result = await helpdeskService.createTicket(prisma, body, user!.userId);
  return Response.json(result);
});

export const GET = withRoute({ query: ListTicketsQueryDto }, async ({ user, query }) => {
  const result = await helpdeskService.listTickets(prisma, query, user!.userId, user!.role);
  return Response.json(result);
});
