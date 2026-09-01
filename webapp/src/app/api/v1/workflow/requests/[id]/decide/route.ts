import { withRoute } from "@/server/lib/route";
import { prisma } from "@/server/lib/prisma";
import { DecideApprovalDto } from "@/server/modules/workflow/dto";
import * as workflowService from "@/server/modules/workflow/service";

export const POST = withRoute({ dto: DecideApprovalDto }, async ({ user, params, body }) => {
  const result = await workflowService.decide(prisma, params.id, body, user!.userId);
  return Response.json(result);
});
