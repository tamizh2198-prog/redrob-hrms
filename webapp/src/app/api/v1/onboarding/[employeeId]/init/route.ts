import { withRoute } from "@/server/lib/route";
import { prisma } from "@/server/lib/prisma";
import { InitChecklistDto } from "@/server/modules/onboarding/dto";
import * as onboardingService from "@/server/modules/onboarding/service";

export const POST = withRoute(
  { roles: ["HR_ADMIN", "HR_ASSOCIATE", "SUPER_ADMIN"], dto: InitChecklistDto },
  async ({ params, body }) => {
    const result = await onboardingService.initChecklist(prisma, params.employeeId, body.templateId);
    return Response.json(result);
  },
);
