import { withRoute } from "@/server/lib/route";
import { prisma } from "@/server/lib/prisma";
import { SubmitLearningRequestDto } from "@/server/modules/learning/dto";
import * as learningService from "@/server/modules/learning/service";

export const POST = withRoute({ dto: SubmitLearningRequestDto }, async ({ user, body }) => {
  const result = await learningService.submitRequest(prisma, user!.userId, body, user!.role);
  return Response.json(result);
});

export const GET = withRoute({ roles: ["SUPER_ADMIN"] }, async ({ req }) => {
  const status = req.nextUrl.searchParams.get("status") ?? undefined;
  const result = await learningService.listAll(prisma, status as never);
  return Response.json(result);
});
