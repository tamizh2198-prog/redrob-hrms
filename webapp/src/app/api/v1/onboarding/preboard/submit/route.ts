import { withRoute } from "@/server/lib/route";
import { prisma } from "@/server/lib/prisma";
import { PreboardSubmitDto } from "@/server/modules/onboarding/dto";
import * as onboardingService from "@/server/modules/onboarding/service";

export const POST = withRoute({ public: true, dto: PreboardSubmitDto }, async ({ body }) => {
  const result = await onboardingService.submitPreboarding(prisma, body.token, body.fieldType, body.valueRef);
  return Response.json(result);
});
