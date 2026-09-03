import { withRoute } from "@/server/lib/route";
import { prisma } from "@/server/lib/prisma";
import { SendRelievingLetterDto } from "@/server/modules/offboarding/dto";
import * as offboardingService from "@/server/modules/offboarding/service";

export const POST = withRoute(
  { roles: ["SUPER_ADMIN"], dto: SendRelievingLetterDto },
  async ({ user, params, body }) => {
    const result = await offboardingService.sendRelievingLetter(prisma, params.id, body, user!.userId);
    return Response.json(result);
  },
);
