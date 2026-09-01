import { withRoute } from "@/server/lib/route";
import { prisma } from "@/server/lib/prisma";
import * as atsService from "@/server/modules/ats/service";

export const GET = withRoute({ public: true }, async ({ req }) => {
  const token = req.nextUrl.searchParams.get("token") ?? "";
  const result = await atsService.getOfferByToken(prisma, token);
  return Response.json(result);
});
