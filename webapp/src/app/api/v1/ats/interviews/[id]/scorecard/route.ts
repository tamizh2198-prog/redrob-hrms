import { withRoute } from "@/server/lib/route";
import { prisma } from "@/server/lib/prisma";
import { SubmitScorecardDto } from "@/server/modules/ats/dto";
import * as atsService from "@/server/modules/ats/service";

export const POST = withRoute({ dto: SubmitScorecardDto }, async ({ user, params, body }) => {
  const result = await atsService.submitScorecard(prisma, params.id, body, user!.userId, user!.role);
  return Response.json(result);
});
