import { withRoute } from "@/server/lib/route";
import { prisma } from "@/server/lib/prisma";
import { CreateHolidayCalendarDto } from "@/server/modules/holiday/dto";
import * as holidayService from "@/server/modules/holiday/service";

export const POST = withRoute(
  { roles: ["HR_ADMIN", "HR_ASSOCIATE", "SUPER_ADMIN"], module: "HOLIDAY", dto: CreateHolidayCalendarDto },
  async ({ body }) => {
    const result = await holidayService.createCalendar(prisma, body);
    return Response.json(result);
  },
);

export const GET = withRoute({}, async ({ req }) => {
  const locationId = req.nextUrl.searchParams.get("locationId") ?? "";
  const year = parseInt(req.nextUrl.searchParams.get("year") ?? "", 10);
  const result = await holidayService.listCalendar(prisma, locationId, year);
  return Response.json(result);
});
