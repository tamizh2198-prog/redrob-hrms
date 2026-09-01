import { withRoute } from "@/server/lib/route";
import { prisma } from "@/server/lib/prisma";
import { SelectOptionalHolidayDto } from "@/server/modules/holiday/dto";
import * as holidayService from "@/server/modules/holiday/service";

export const POST = withRoute({ dto: SelectOptionalHolidayDto }, async ({ user, body }) => {
  const result = await holidayService.selectOptionalHoliday(prisma, user!.userId, body.holidayId);
  return Response.json(result);
});
