import { withCron } from "@/server/lib/cron";
import { prisma } from "@/server/lib/prisma";
import { sendWeeklyAnomalyDigest } from "@/server/modules/assistant/anomaly-digest";

export const GET = withCron(async () => {
  await sendWeeklyAnomalyDigest(prisma);
  return Response.json({ ok: true });
});
