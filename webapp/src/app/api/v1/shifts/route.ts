import { withRoute } from "@/server/lib/route";
import { prisma } from "@/server/lib/prisma";
import { CreateShiftDto } from "@/server/modules/shift/dto";
import * as shiftService from "@/server/modules/shift/service";

export const POST = withRoute({ roles: ["HR_ADMIN", "HR_ASSOCIATE", "SUPER_ADMIN"], module: "SHIFT", dto: CreateShiftDto }, async ({ body }) => {
  const result = await shiftService.createShift(prisma, body);
  return Response.json(result);
});

export const GET = withRoute({}, async () => {
  const result = await shiftService.listShifts(prisma);
  return Response.json(result);
});
