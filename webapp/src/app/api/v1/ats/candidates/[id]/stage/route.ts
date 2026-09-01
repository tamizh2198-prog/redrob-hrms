import { withRoute } from "@/server/lib/route";
import { prisma } from "@/server/lib/prisma";
import { MoveStageDto } from "@/server/modules/ats/dto";
import * as atsService from "@/server/modules/ats/service";

export const PATCH = withRoute(
  { roles: ["MANAGER", "HR_ADMIN", "HR_ASSOCIATE", "SUPER_ADMIN"], dto: MoveStageDto },
  async ({ user, params, body }) => {
    const result = await atsService.moveStage(prisma, params.id, body.stage, user!.userId, user!.role);
    return Response.json(result);
  },
);
