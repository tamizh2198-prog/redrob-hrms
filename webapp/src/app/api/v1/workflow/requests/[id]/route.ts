import { withRoute } from "@/server/lib/route";
import { prisma } from "@/server/lib/prisma";
import * as workflowService from "@/server/modules/workflow/service";

export const GET = withRoute({}, async ({ user, params }) => {
  const result = await workflowService.getRequest(prisma, params.id, { userId: user!.userId, role: user!.role });
  return Response.json(result);
});
