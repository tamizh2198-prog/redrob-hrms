import { withRoute } from "@/server/lib/route";
import { prisma } from "@/server/lib/prisma";
import { CreateOfferDto } from "@/server/modules/ats/dto";
import * as atsService from "@/server/modules/ats/service";

export const POST = withRoute(
  { roles: ["HR_ADMIN", "HR_ASSOCIATE", "SUPER_ADMIN"], dto: CreateOfferDto },
  async ({ body }) => {
    const result = await atsService.createOffer(prisma, body);
    return Response.json(result);
  },
);
