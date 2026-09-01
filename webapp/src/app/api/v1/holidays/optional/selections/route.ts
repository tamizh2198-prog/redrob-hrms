import { withRoute } from "@/server/lib/route";
import { prisma } from "@/server/lib/prisma";
import * as holidayService from "@/server/modules/holiday/service";

export const GET = withRoute({}, async ({ user }) => {
  const result = await holidayService.listSelections(prisma, user!.userId);
  return Response.json(result);
});
