import { withRoute } from "@/server/lib/route";
import { prisma } from "@/server/lib/prisma";
import * as offboardingService from "@/server/modules/offboarding/service";

export const POST = withRoute({ roles: ["HR_ADMIN", "HR_ASSOCIATE", "SUPER_ADMIN"] }, async ({ user, params }) => {
  const result = await offboardingService.acceptResignation(prisma, params.id, user!.userId);
  return Response.json(result);
});
