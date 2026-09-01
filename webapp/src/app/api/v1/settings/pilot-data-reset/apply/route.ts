import { withRoute } from "@/server/lib/route";
import { prisma } from "@/server/lib/prisma";
import { ConfirmPilotDataResetDto } from "@/server/modules/settings/dto";
import * as settingsService from "@/server/modules/settings/service";

export const POST = withRoute({ roles: ["SUPER_ADMIN"], dto: ConfirmPilotDataResetDto }, async ({ body }) => {
  const result = await settingsService.applyPilotDataReset(prisma, body.confirmationPhrase);
  return Response.json(result);
});
