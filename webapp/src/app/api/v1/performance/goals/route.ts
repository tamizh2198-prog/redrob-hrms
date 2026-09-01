import { withRoute } from "@/server/lib/route";
import { prisma } from "@/server/lib/prisma";
import { CreateGoalDto } from "@/server/modules/performance/dto";
import * as performanceService from "@/server/modules/performance/service";

export const POST = withRoute({ dto: CreateGoalDto }, async ({ user, body }) => {
  const result = await performanceService.createGoal(prisma, body, user!.userId, user!.role);
  return Response.json(result);
});

export const GET = withRoute({}, async ({ req, user }) => {
  const employeeId = req.nextUrl.searchParams.get("employeeId") ?? "";
  const cycleId = req.nextUrl.searchParams.get("cycleId") ?? undefined;
  const result = await performanceService.listGoals(prisma, employeeId, cycleId, {
    userId: user!.userId,
    role: user!.role,
  });
  return Response.json(result);
});
