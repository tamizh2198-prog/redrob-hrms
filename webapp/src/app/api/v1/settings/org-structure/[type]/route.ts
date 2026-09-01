import { withRoute } from "@/server/lib/route";
import { prisma } from "@/server/lib/prisma";
import { CreateOrgUnitDto } from "@/server/modules/settings/dto";
import * as settingsService from "@/server/modules/settings/service";

export const POST = withRoute({ roles: ["SUPER_ADMIN"], dto: CreateOrgUnitDto }, async ({ params, body }) => {
  const result = await settingsService.createOrgUnit(prisma, params.type, body);
  return Response.json(result);
});
