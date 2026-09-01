import { withRoute } from "@/server/lib/route";
import { prisma } from "@/server/lib/prisma";
import { AssignRosterDto } from "@/server/modules/shift/dto";
import * as shiftService from "@/server/modules/shift/service";

export const POST = withRoute({ roles: ["HR_ADMIN", "HR_ASSOCIATE", "SUPER_ADMIN"], module: "SHIFT", dto: AssignRosterDto }, async ({ body }) => {
  const result = await shiftService.assignRoster(prisma, body);
  return Response.json(result);
});
