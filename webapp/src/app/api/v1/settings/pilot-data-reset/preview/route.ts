import { withRoute } from "@/server/lib/route";
import { prisma } from "@/server/lib/prisma";
import * as settingsService from "@/server/modules/settings/service";

export const GET = withRoute({ roles: ["SUPER_ADMIN"] }, async () => {
  const result = await settingsService.previewPilotDataReset(prisma);
  return Response.json(result);
});
