import { withRoute } from "@/server/lib/route";
import { prisma } from "@/server/lib/prisma";
import { SubmitExitInterviewDto } from "@/server/modules/offboarding/dto";
import * as offboardingService from "@/server/modules/offboarding/service";

export const POST = withRoute({ dto: SubmitExitInterviewDto }, async ({ user, params, body }) => {
  const result = await offboardingService.submitExitInterview(prisma, params.id, body, user!.userId, user!.role);
  return Response.json(result);
});
