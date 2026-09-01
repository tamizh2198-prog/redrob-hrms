import { withRoute } from "@/server/lib/route";
import { prisma } from "@/server/lib/prisma";
import * as offboardingService from "@/server/modules/offboarding/service";

export const GET = withRoute({ roles: ["HR_ADMIN", "HR_ASSOCIATE", "SUPER_ADMIN"] }, async () => {
  const result = await offboardingService.listResignations(prisma);
  return Response.json(result);
});
