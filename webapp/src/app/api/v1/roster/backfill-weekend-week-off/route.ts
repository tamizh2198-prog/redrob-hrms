import { withRoute } from "@/server/lib/route";
import { prisma } from "@/server/lib/prisma";
import * as shiftService from "@/server/modules/shift/service";

export const POST = withRoute({ roles: ["SUPER_ADMIN"], module: "SHIFT" }, async ({ req }) => {
  const dryRunRaw = req.nextUrl.searchParams.get("dryRun");
  const result = await shiftService.backfillWeekendWeekOff(prisma, dryRunRaw !== "false");
  return Response.json(result);
});
