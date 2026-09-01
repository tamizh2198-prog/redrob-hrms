import { withRoute } from "@/server/lib/route";
import { prisma } from "@/server/lib/prisma";
import { CreateRequisitionDto } from "@/server/modules/ats/dto";
import * as atsService from "@/server/modules/ats/service";

const ROLES = ["MANAGER", "HR_ADMIN", "HR_ASSOCIATE", "SUPER_ADMIN"] as const;

export const POST = withRoute({ roles: [...ROLES], dto: CreateRequisitionDto }, async ({ user, body }) => {
  const result = await atsService.createRequisition(prisma, body, user!.userId);
  return Response.json(result);
});

export const GET = withRoute({ roles: [...ROLES] }, async ({ user }) => {
  const result = await atsService.listRequisitions(prisma, user!.userId, user!.role);
  return Response.json(result);
});
