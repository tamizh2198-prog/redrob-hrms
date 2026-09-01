import { withRoute } from "@/server/lib/route";
import { prisma } from "@/server/lib/prisma";
import * as onboardingService from "@/server/modules/onboarding/service";

export const GET = withRoute({}, async ({ user }) => {
  const result = await onboardingService.listMyProbationFeedback(prisma, user!.userId);
  return Response.json(result);
});
