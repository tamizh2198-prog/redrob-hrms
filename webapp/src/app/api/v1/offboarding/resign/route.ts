import { withRoute } from "@/server/lib/route";
import { prisma } from "@/server/lib/prisma";
import { SubmitResignationDto } from "@/server/modules/offboarding/dto";
import * as offboardingService from "@/server/modules/offboarding/service";

export const POST = withRoute({ dto: SubmitResignationDto }, async ({ user, body }) => {
  const result = await offboardingService.submitResignation(prisma, body, user!.userId, user!.role);
  return Response.json(result);
});
