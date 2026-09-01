import { withRoute } from "@/server/lib/route";
import { prisma } from "@/server/lib/prisma";
import { UpdateIntegrationDto } from "@/server/modules/settings/dto";
import * as settingsService from "@/server/modules/settings/service";

export const PATCH = withRoute({ roles: ["SUPER_ADMIN"], dto: UpdateIntegrationDto }, async ({ params, body }) => {
  const result = await settingsService.updateIntegration(prisma, params.type, body);
  return Response.json(result);
});
