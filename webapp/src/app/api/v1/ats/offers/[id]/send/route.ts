import { withRoute } from "@/server/lib/route";
import { prisma } from "@/server/lib/prisma";
import { SendOfferDto } from "@/server/modules/ats/dto";
import * as atsService from "@/server/modules/ats/service";

export const POST = withRoute(
  { roles: ["HR_ADMIN", "HR_ASSOCIATE", "SUPER_ADMIN"], dto: SendOfferDto },
  async ({ params, body }) => {
    const result = await atsService.sendOffer(prisma, params.id, body.templateId);
    return Response.json(result);
  },
);
