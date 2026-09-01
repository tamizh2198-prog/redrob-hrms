import { withRoute } from "@/server/lib/route";
import { prisma } from "@/server/lib/prisma";
import { ConfirmActionDto } from "@/server/modules/assistant/dto";
import * as assistantService from "@/server/modules/assistant/service";

export const POST = withRoute({ dto: ConfirmActionDto }, async ({ user, body }) => {
  const result = await assistantService.confirmAction(prisma, user!.userId, body);
  return Response.json(result);
});
