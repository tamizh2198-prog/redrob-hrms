import { withRoute } from "@/server/lib/route";
import { prisma } from "@/server/lib/prisma";
import { ReturnAssetDto } from "@/server/modules/assets/dto";
import * as assetsService from "@/server/modules/assets/service";

export const POST = withRoute(
  { roles: ["HR_ADMIN", "HR_ASSOCIATE", "SUPER_ADMIN"], dto: ReturnAssetDto },
  async ({ params, body }) => {
    const result = await assetsService.returnAsset(prisma, params.id, body);
    return Response.json(result);
  },
);
