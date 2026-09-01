import { withRoute } from "@/server/lib/route";
import { prisma } from "@/server/lib/prisma";
import * as workflowService from "@/server/modules/workflow/service";

export const GET = withRoute({}, async ({ user }) => {
  const result = await workflowService.listMyApprovals(prisma, user!.userId, user!.role);
  return Response.json(result);
});
