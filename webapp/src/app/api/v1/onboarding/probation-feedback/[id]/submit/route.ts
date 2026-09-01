import { withRoute } from "@/server/lib/route";
import { prisma } from "@/server/lib/prisma";
import { SubmitProbationFeedbackDto } from "@/server/modules/onboarding/dto";
import * as onboardingService from "@/server/modules/onboarding/service";

export const POST = withRoute({ dto: SubmitProbationFeedbackDto }, async ({ user, params, body }) => {
  const result = await onboardingService.submitProbationFeedback(prisma, params.id, user!.userId, body);
  return Response.json(result);
});
