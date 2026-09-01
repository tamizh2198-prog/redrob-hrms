import { withRoute } from "@/server/lib/route";
import { prisma } from "@/server/lib/prisma";
import { SubmitMonthlyEvaluationDto } from "@/server/modules/performance/dto";
import * as performanceService from "@/server/modules/performance/service";

export const POST = withRoute({ dto: SubmitMonthlyEvaluationDto }, async ({ user, body }) => {
  const result = await performanceService.submitMonthlyEvaluation(prisma, body, user!.userId);
  return Response.json(result);
});

export const GET = withRoute({}, async ({ req, user }) => {
  const employeeId = req.nextUrl.searchParams.get("employeeId") ?? "";
  const result = await performanceService.listMonthlyEvaluations(prisma, employeeId, user!.userId, user!.role);
  return Response.json(result);
});
