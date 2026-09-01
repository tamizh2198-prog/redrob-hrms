import { withRoute } from "@/server/lib/route";
import { prisma } from "@/server/lib/prisma";
import { LearningDecisionDto } from "@/server/modules/learning/dto";
import * as learningService from "@/server/modules/learning/service";

export const POST = withRoute({ dto: LearningDecisionDto }, async ({ user, params, body }) => {
  const result = await learningService.decide(prisma, params.id, user!.userId, body, user!.role);
  return Response.json(result);
});
