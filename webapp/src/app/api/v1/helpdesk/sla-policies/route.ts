import { withRoute } from "@/server/lib/route";
import { prisma } from "@/server/lib/prisma";
import { UpsertSlaPolicyDto } from "@/server/modules/helpdesk/dto";
import * as helpdeskService from "@/server/modules/helpdesk/service";

const ROLES = ["HR_ADMIN", "HR_ASSOCIATE", "SUPER_ADMIN"] as const;

export const GET = withRoute({ roles: [...ROLES] }, async () => {
  const result = await helpdeskService.listSlaPolicies(prisma);
  return Response.json(result);
});

export const POST = withRoute({ roles: [...ROLES], dto: UpsertSlaPolicyDto }, async ({ body }) => {
  const result = await helpdeskService.upsertSlaPolicy(prisma, body);
  return Response.json(result);
});
