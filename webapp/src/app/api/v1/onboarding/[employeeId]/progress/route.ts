import { withRoute } from "@/server/lib/route";
import { prisma } from "@/server/lib/prisma";
import * as onboardingService from "@/server/modules/onboarding/service";

export const GET = withRoute({}, async ({ user, params }) => {
  const result = await onboardingService.getProgress(prisma, params.employeeId, {
    userId: user!.userId,
    role: user!.role,
  });
  return Response.json(result);
});
