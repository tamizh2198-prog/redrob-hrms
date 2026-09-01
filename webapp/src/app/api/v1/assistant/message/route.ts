import { withRoute } from "@/server/lib/route";
import { prisma } from "@/server/lib/prisma";
import { SendMessageDto } from "@/server/modules/assistant/dto";
import * as assistantService from "@/server/modules/assistant/service";

export const POST = withRoute({ dto: SendMessageDto }, async ({ user, body }) => {
  const result = await assistantService.sendMessage(prisma, user!.userId, user!.role, body);
  return Response.json(result);
});
