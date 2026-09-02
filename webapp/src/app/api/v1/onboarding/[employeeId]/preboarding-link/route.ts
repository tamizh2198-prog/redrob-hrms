import { withRoute } from "@/server/lib/route";
import { prisma } from "@/server/lib/prisma";
import * as onboardingService from "@/server/modules/onboarding/service";

export const POST = withRoute({ roles: ["HR_ADMIN", "HR_ASSOCIATE", "SUPER_ADMIN"] }, async ({ params }) => {
  const result = await onboardingService.resendPreboardingLink(prisma, params.employeeId);
  return Response.json(result);
});
