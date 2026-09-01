import { withRoute } from "@/server/lib/route";
import { prisma } from "@/server/lib/prisma";
import * as assetsService from "@/server/modules/assets/service";

export const GET = withRoute({}, async ({ user }) => {
  const result = await assetsService.getEmployeeAssignments(prisma, user!.userId);
  return Response.json(result);
});
