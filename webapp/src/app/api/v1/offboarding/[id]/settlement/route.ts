import { withRoute } from "@/server/lib/route";
import { prisma } from "@/server/lib/prisma";
import { ComputeSettlementDto } from "@/server/modules/offboarding/dto";
import * as offboardingService from "@/server/modules/offboarding/service";

export const GET = withRoute({ roles: ["HR_ADMIN", "HR_ASSOCIATE", "SUPER_ADMIN"], query: ComputeSettlementDto }, async ({ params, query }) => {
  const result = await offboardingService.computeSettlement(prisma, params.id, query);
  return Response.json(result);
});
