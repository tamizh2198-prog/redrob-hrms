import { withRoute } from "@/server/lib/route";
import { prisma } from "@/server/lib/prisma";
import { MarkSettlementPaidDto } from "@/server/modules/offboarding/dto";
import * as offboardingService from "@/server/modules/offboarding/service";

export const POST = withRoute({ roles: ["HR_ADMIN", "SUPER_ADMIN"], dto: MarkSettlementPaidDto }, async ({ user, params, body }) => {
  const result = await offboardingService.markSettlementPaid(prisma, params.id, body, user!.userId);
  return Response.json(result);
});
