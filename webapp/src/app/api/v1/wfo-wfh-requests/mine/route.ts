import { withRoute } from "@/server/lib/route";
import { prisma } from "@/server/lib/prisma";
import * as wfoWfhService from "@/server/modules/shift/wfo-wfh-request-service";

export const GET = withRoute({}, async ({ user }) => {
  const result = await wfoWfhService.listMine(prisma, user!.userId);
  return Response.json(result);
});
