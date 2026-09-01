import { withRoute } from "@/server/lib/route";
import { prisma } from "@/server/lib/prisma";
import * as assistantService from "@/server/modules/assistant/service";

export const GET = withRoute({}, async ({ user, params }) => {
  const result = await assistantService.listConversationMessages(prisma, user!.userId, params.id);
  return Response.json(result);
});
