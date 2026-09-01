import { withRoute } from "@/server/lib/route";
import { prisma } from "@/server/lib/prisma";
import * as learningService from "@/server/modules/learning/service";

export const POST = withRoute({ roles: ["SUPER_ADMIN"] }, async ({ user, params }) => {
  const result = await learningService.markReimbursed(prisma, params.id, user!.userId);
  return Response.json(result);
});
