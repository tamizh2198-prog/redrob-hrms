import { withRoute } from "@/server/lib/route";
import { prisma } from "@/server/lib/prisma";
import { CreateCandidateDto } from "@/server/modules/ats/dto";
import * as atsService from "@/server/modules/ats/service";

export const POST = withRoute({ public: true, dto: CreateCandidateDto }, async ({ body }) => {
  const result = await atsService.createCandidate(prisma, body);
  return Response.json(result);
});

export const GET = withRoute({ roles: ["MANAGER", "HR_ADMIN", "HR_ASSOCIATE", "SUPER_ADMIN"] }, async ({ req, user }) => {
  const requisitionId = req.nextUrl.searchParams.get("requisitionId") ?? undefined;
  const result = await atsService.listCandidates(prisma, requisitionId, user!.userId, user!.role);
  return Response.json(result);
});
