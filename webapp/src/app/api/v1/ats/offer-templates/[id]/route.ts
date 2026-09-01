import { withRoute } from "@/server/lib/route";
import { prisma } from "@/server/lib/prisma";
import { UpdateOfferTemplateDto } from "@/server/modules/ats/dto";
import * as atsService from "@/server/modules/ats/service";

const ROLES = ["HR_ADMIN", "HR_ASSOCIATE", "SUPER_ADMIN"] as const;

export const PATCH = withRoute({ roles: [...ROLES], dto: UpdateOfferTemplateDto }, async ({ params, body }) => {
  const result = await atsService.updateOfferTemplate(prisma, params.id, body);
  return Response.json(result);
});

export const DELETE = withRoute({ roles: [...ROLES] }, async ({ params }) => {
  const result = await atsService.deleteOfferTemplate(prisma, params.id);
  return Response.json(result);
});
