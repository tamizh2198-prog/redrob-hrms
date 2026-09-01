import { withRoute } from "@/server/lib/route";
import { prisma } from "@/server/lib/prisma";
import * as learningService from "@/server/modules/learning/service";

export const GET = withRoute({}, async ({ user }) => {
  const result = await learningService.listPendingForApprover(prisma, user!.userId);
  return Response.json(result);
});
