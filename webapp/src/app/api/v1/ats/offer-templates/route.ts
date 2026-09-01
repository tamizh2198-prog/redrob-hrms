import { withRoute } from "@/server/lib/route";
import { prisma } from "@/server/lib/prisma";
import { CreateOfferTemplateDto } from "@/server/modules/ats/dto";
import * as atsService from "@/server/modules/ats/service";

const ROLES = ["HR_ADMIN", "HR_ASSOCIATE", "SUPER_ADMIN"] as const;

export const POST = withRoute({ roles: [...ROLES], dto: CreateOfferTemplateDto }, async ({ body }) => {
  const result = await atsService.createOfferTemplate(prisma, body);
  return Response.json(result);
});

export const GET = withRoute({ roles: [...ROLES] }, async () => {
  const result = await atsService.listOfferTemplates(prisma);
  return Response.json(result);
});
