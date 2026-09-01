import { withRoute } from "@/server/lib/route";
import { prisma } from "@/server/lib/prisma";
import { RespondOfferDto } from "@/server/modules/ats/dto";
import * as atsService from "@/server/modules/ats/service";

export const POST = withRoute({ public: true, dto: RespondOfferDto }, async ({ body }) => {
  const result = await atsService.respondOffer(prisma, body.token, body.decision);
  return Response.json(result);
});
