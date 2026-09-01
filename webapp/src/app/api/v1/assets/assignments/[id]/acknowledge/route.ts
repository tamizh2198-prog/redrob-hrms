import { withRoute } from "@/server/lib/route";
import { prisma } from "@/server/lib/prisma";
import * as assetsService from "@/server/modules/assets/service";

export const POST = withRoute({}, async ({ user, params }) => {
  const result = await assetsService.acknowledgeAsset(prisma, params.id, user!.userId);
  return Response.json(result);
});
