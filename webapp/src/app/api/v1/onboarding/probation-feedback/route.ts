import { withRoute } from "@/server/lib/route";
import { prisma } from "@/server/lib/prisma";
import * as onboardingService from "@/server/modules/onboarding/service";

export const GET = withRoute({ roles: ["HR_ADMIN", "HR_ASSOCIATE", "SUPER_ADMIN"] }, async () => {
  const result = await onboardingService.listProbationFeedback(prisma);
  return Response.json(result);
});
