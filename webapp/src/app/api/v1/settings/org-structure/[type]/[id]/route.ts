import { withRoute } from "@/server/lib/route";
import { prisma } from "@/server/lib/prisma";
import { UpdateOrgUnitDto } from "@/server/modules/settings/dto";
import * as settingsService from "@/server/modules/settings/service";

export const PATCH = withRoute({ roles: ["SUPER_ADMIN"], dto: UpdateOrgUnitDto }, async ({ params, body }) => {
  const result = await settingsService.updateOrgUnit(prisma, params.type, params.id, body);
  return Response.json(result);
});
