import { withRoute } from "@/server/lib/route";
import { prisma } from "@/server/lib/prisma";
import { CreateWorkflowDefinitionDto } from "@/server/modules/workflow/dto";
import * as workflowService from "@/server/modules/workflow/service";

export const POST = withRoute(
  { roles: ["HR_ADMIN", "SUPER_ADMIN"], module: "WORKFLOW", dto: CreateWorkflowDefinitionDto },
  async ({ user, body }) => {
    const result = await workflowService.createDefinition(prisma, body, user!.userId);
    return Response.json(result);
  },
);

export const GET = withRoute({ roles: ["HR_ADMIN", "SUPER_ADMIN"], module: "WORKFLOW" }, async () => {
  const result = await workflowService.listDefinitions(prisma);
  return Response.json(result);
});
