import { withRoute } from "@/server/lib/route";
import { prisma } from "@/server/lib/prisma";
import { RejectResignationDto } from "@/server/modules/offboarding/dto";
import * as offboardingService from "@/server/modules/offboarding/service";

export const POST = withRoute(
  { roles: ["HR_ADMIN", "HR_ASSOCIATE", "SUPER_ADMIN"], dto: RejectResignationDto },
  async ({ user, params, body }) => {
    const result = await offboardingService.rejectResignation(prisma, params.id, body, user!.userId);
    return Response.json(result);
  },
);
