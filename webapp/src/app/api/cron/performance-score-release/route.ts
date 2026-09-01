import { withCron } from "@/server/lib/cron";
import { prisma } from "@/server/lib/prisma";
import { releaseDueScores } from "@/server/modules/performance/score-release";

export const GET = withCron(async () => {
  await releaseDueScores(prisma);
  return Response.json({ ok: true });
});
