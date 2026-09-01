import { withRoute } from "@/server/lib/route";
import { prisma } from "@/server/lib/prisma";
import { AdjustLwdDto } from "@/server/modules/offboarding/dto";
import * as offboardingService from "@/server/modules/offboarding/service";

export const POST = withRoute({ dto: AdjustLwdDto }, async ({ user, params, body }) => {
  const result = await offboardingService.adjustLwd(prisma, params.id, body, user!.userId, user!.role);
  return Response.json(result);
});
