import { withRoute } from "@/server/lib/route";
import { prisma } from "@/server/lib/prisma";
import { ScheduleInterviewDto } from "@/server/modules/ats/dto";
import * as atsService from "@/server/modules/ats/service";

export const POST = withRoute(
  { roles: ["MANAGER", "HR_ADMIN", "HR_ASSOCIATE", "SUPER_ADMIN"], dto: ScheduleInterviewDto },
  async ({ user, params, body }) => {
    const result = await atsService.scheduleInterview(prisma, params.id, body, user!.userId, user!.role);
    return Response.json(result);
  },
);
