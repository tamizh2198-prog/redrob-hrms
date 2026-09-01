import { withRoute } from "@/server/lib/route";
import { prisma } from "@/server/lib/prisma";
import { CreateFaqDto, SearchFaqQueryDto } from "@/server/modules/helpdesk/dto";
import * as helpdeskService from "@/server/modules/helpdesk/service";

export const GET = withRoute({ query: SearchFaqQueryDto }, async ({ query }) => {
  const result = await helpdeskService.searchFaq(prisma, query);
  return Response.json(result);
});

export const POST = withRoute({ roles: ["HR_ADMIN", "HR_ASSOCIATE", "SUPER_ADMIN"], dto: CreateFaqDto }, async ({ body }) => {
  const result = await helpdeskService.createFaq(prisma, body);
  return Response.json(result);
});
