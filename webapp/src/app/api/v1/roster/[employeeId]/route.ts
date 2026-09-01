import { withRoute } from "@/server/lib/route";
import { prisma } from "@/server/lib/prisma";
import * as shiftService from "@/server/modules/shift/service";

export const GET = withRoute({}, async ({ req, user, params }) => {
  const from = req.nextUrl.searchParams.get("from") ?? "";
  const to = req.nextUrl.searchParams.get("to") ?? "";
  const result = await shiftService.getRoster(prisma, params.employeeId, new Date(from), new Date(to), {
    userId: user?.userId,
    role: user?.role,
  });
  return Response.json(result);
});
