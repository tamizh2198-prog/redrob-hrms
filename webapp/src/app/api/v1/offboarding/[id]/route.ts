import { withRoute } from "@/server/lib/route";
import { prisma } from "@/server/lib/prisma";
import * as offboardingService from "@/server/modules/offboarding/service";

export const GET = withRoute({}, async ({ user, params }) => {
  const result = await offboardingService.getResignation(prisma, params.id, { userId: user!.userId, role: user!.role });
  return Response.json(result);
});
