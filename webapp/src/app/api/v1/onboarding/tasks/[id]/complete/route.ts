import { withRoute } from "@/server/lib/route";
import { prisma } from "@/server/lib/prisma";
import * as onboardingService from "@/server/modules/onboarding/service";

export const POST = withRoute({}, async ({ user, params }) => {
  const result = await onboardingService.completeTask(prisma, params.id, user!.userId, user!.role);
  return Response.json(result);
});
