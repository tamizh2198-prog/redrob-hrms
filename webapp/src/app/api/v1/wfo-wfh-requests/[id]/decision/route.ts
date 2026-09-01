import { withRoute } from "@/server/lib/route";
import { prisma } from "@/server/lib/prisma";
import { WfoWfhDecisionDto } from "@/server/modules/shift/dto";
import * as wfoWfhService from "@/server/modules/shift/wfo-wfh-request-service";

export const POST = withRoute({ dto: WfoWfhDecisionDto }, async ({ user, params, body }) => {
  const result = await wfoWfhService.decide(prisma, params.id, user!.userId, body, user!.role);
  return Response.json(result);
});
