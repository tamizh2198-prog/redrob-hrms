import { withRoute } from "@/server/lib/route";
import { prisma } from "@/server/lib/prisma";
import { CreateApprovalRequestDto } from "@/server/modules/workflow/dto";
import * as workflowService from "@/server/modules/workflow/service";

// "Any module — consumes the engine via a standard API" — open to any
// authenticated caller, not role-gated.
export const POST = withRoute({ dto: CreateApprovalRequestDto }, async ({ user, body }) => {
  const result = await workflowService.createRequest(prisma, body, user!.userId);
  return Response.json(result);
});
