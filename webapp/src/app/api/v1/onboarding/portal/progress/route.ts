import { withRoute } from "@/server/lib/route";
import { prisma } from "@/server/lib/prisma";
import * as onboardingService from "@/server/modules/onboarding/service";

export const GET = withRoute({ public: true }, async ({ req }) => {
  const token = req.nextUrl.searchParams.get("token") ?? "";
  const result = await onboardingService.getProgressViaPortal(prisma, token);
  return Response.json(result);
});
