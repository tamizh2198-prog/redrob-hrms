import { withRoute } from "@/server/lib/route";
import { prisma } from "@/server/lib/prisma";
import { CreateAssetRequestDto } from "@/server/modules/assets/dto";
import * as assetsService from "@/server/modules/assets/service";

export const POST = withRoute({ dto: CreateAssetRequestDto }, async ({ user, body }) => {
  const result = await assetsService.createAssetRequest(prisma, body, user!.userId);
  return Response.json(result);
});

export const GET = withRoute({}, async ({ req, user }) => {
  const employeeId = req.nextUrl.searchParams.get("employeeId") ?? undefined;
  const result = await assetsService.listAssetRequests(prisma, { employeeId }, { userId: user!.userId, role: user!.role });
  return Response.json(result);
});
