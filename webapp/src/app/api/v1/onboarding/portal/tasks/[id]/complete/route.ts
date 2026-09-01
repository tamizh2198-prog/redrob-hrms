import { withRoute } from "@/server/lib/route";
import { prisma } from "@/server/lib/prisma";
import { PortalCompleteTaskDto } from "@/server/modules/onboarding/dto";
import * as onboardingService from "@/server/modules/onboarding/service";

export const POST = withRoute({ public: true, dto: PortalCompleteTaskDto }, async ({ params, body }) => {
  const result = await onboardingService.completeTaskViaPortal(prisma, params.id, body.token);
  return Response.json(result);
});
