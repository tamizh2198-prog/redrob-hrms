import { withRoute } from "@/server/lib/route";
import { prisma } from "@/server/lib/prisma";
import { DecideAssetRequestDto } from "@/server/modules/assets/dto";
import * as assetsService from "@/server/modules/assets/service";

export const POST = withRoute({ roles: ["HR_ADMIN", "SUPER_ADMIN"], dto: DecideAssetRequestDto }, async ({ user, params, body }) => {
  const result = await assetsService.decideAssetRequest(prisma, params.id, body.approve, user!.userId, user!.role);
  return Response.json(result);
});
