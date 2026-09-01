import { withRoute } from "@/server/lib/route";
import { prisma } from "@/server/lib/prisma";
import * as atsService from "@/server/modules/ats/service";

export const GET = withRoute({}, async ({ params }) => {
  const result = await atsService.getPipelineAnalytics(prisma, params.id);
  return Response.json(result);
});
