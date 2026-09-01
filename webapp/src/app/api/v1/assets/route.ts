import { withRoute } from "@/server/lib/route";
import { prisma } from "@/server/lib/prisma";
import { CreateAssetDto } from "@/server/modules/assets/dto";
import * as assetsService from "@/server/modules/assets/service";

export const POST = withRoute(
  { roles: ["HR_ADMIN", "HR_ASSOCIATE", "SUPER_ADMIN"], dto: CreateAssetDto },
  async ({ body }) => {
    const result = await assetsService.createAsset(prisma, body);
    return Response.json(result);
  },
);

export const GET = withRoute({ roles: ["MANAGER", "HR_ADMIN", "HR_ASSOCIATE", "SUPER_ADMIN"] }, async ({ req }) => {
  const status = req.nextUrl.searchParams.get("status") ?? undefined;
  const result = await assetsService.listAssets(prisma, status as never);
  return Response.json(result);
});
