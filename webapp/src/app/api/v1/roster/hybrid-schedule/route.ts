import { withRoute } from "@/server/lib/route";
import { prisma } from "@/server/lib/prisma";
import { SetHybridScheduleDto } from "@/server/modules/shift/dto";
import * as shiftService from "@/server/modules/shift/service";

// Registered before the '[employeeId]' route so the literal path segment
// isn't swallowed as an employee id — Next.js's file-based routing already
// prefers this static segment over the dynamic one, so no ordering concern
// here (unlike Nest's controller-registration order).
export const GET = withRoute({}, async ({ req, user }) => {
  const employeeId = req.nextUrl.searchParams.get("employeeId") ?? "";
  const year = Number(req.nextUrl.searchParams.get("year"));
  const month = Number(req.nextUrl.searchParams.get("month"));
  const result = await shiftService.getEmployeeHybridSchedule(prisma, employeeId, year, month, {
    userId: user?.userId,
    role: user?.role,
  });
  return Response.json(result);
});

export const POST = withRoute({ roles: ["HR_ADMIN", "HR_ASSOCIATE", "SUPER_ADMIN"], module: "SHIFT", dto: SetHybridScheduleDto }, async ({ body }) => {
  const result = await shiftService.setEmployeeHybridSchedule(prisma, body);
  return Response.json(result);
});
