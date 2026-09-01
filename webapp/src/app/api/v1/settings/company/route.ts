import { withRoute } from "@/server/lib/route";
import { prisma } from "@/server/lib/prisma";
import { UpdateCompanySettingsDto } from "@/server/modules/settings/dto";
import * as settingsService from "@/server/modules/settings/service";

export const GET = withRoute({ roles: ["HR_ADMIN", "HR_ASSOCIATE", "SUPER_ADMIN"] }, async () => {
  const result = await settingsService.getCompanySettings(prisma);
  return Response.json(result);
});

export const PATCH = withRoute({ roles: ["SUPER_ADMIN"], dto: UpdateCompanySettingsDto }, async ({ body }) => {
  const result = await settingsService.updateCompanySettings(prisma, body);
  return Response.json(result);
});
