import { withRoute } from "@/server/lib/route";
import { prisma } from "@/server/lib/prisma";
import { SubmitSelfAssessmentDto } from "@/server/modules/performance/dto";
import * as performanceService from "@/server/modules/performance/service";

export const POST = withRoute({ dto: SubmitSelfAssessmentDto }, async ({ user, body }) => {
  const result = await performanceService.submitSelfAssessment(prisma, body, user!.userId);
  return Response.json(result);
});
