import { withRoute } from "@/server/lib/route";
import { prisma } from "@/server/lib/prisma";
import { UpdateRelievingLetterDto } from "@/server/modules/offboarding/dto";
import * as offboardingService from "@/server/modules/offboarding/service";

export const PATCH = withRoute({ roles: ["SUPER_ADMIN"], dto: UpdateRelievingLetterDto }, async ({ params, body }) => {
  const result = await offboardingService.updateRelievingLetterSnapshot(prisma, params.id, body);
  return Response.json(result);
});
