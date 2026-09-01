import { withRoute } from "@/server/lib/route";
import { prisma } from "@/server/lib/prisma";
import { CreateTemplateDto } from "@/server/modules/onboarding/dto";
import * as onboardingService from "@/server/modules/onboarding/service";

export const POST = withRoute(
  { roles: ["HR_ADMIN", "HR_ASSOCIATE", "SUPER_ADMIN"], dto: CreateTemplateDto },
  async ({ body }) => {
    const result = await onboardingService.createTemplate(prisma, body);
    return Response.json(result);
  },
);

export const GET = withRoute({ roles: ["HR_ADMIN", "HR_ASSOCIATE", "SUPER_ADMIN"] }, async () => {
  const result = await onboardingService.listTemplates(prisma);
  return Response.json(result);
});
