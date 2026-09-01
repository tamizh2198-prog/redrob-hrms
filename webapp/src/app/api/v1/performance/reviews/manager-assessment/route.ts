import { withRoute } from "@/server/lib/route";
import { prisma } from "@/server/lib/prisma";
import { SubmitManagerAssessmentDto } from "@/server/modules/performance/dto";
import * as performanceService from "@/server/modules/performance/service";

export const POST = withRoute({ dto: SubmitManagerAssessmentDto }, async ({ user, body }) => {
  const result = await performanceService.submitManagerAssessment(prisma, body, user!.userId, user!.role);
  return Response.json(result);
});
