import { withCron } from "@/server/lib/cron";
import { prisma } from "@/server/lib/prisma";
import { sendDueScheduledReports } from "@/server/modules/analytics/report-scheduler";

export const GET = withCron(async () => {
  await sendDueScheduledReports(prisma);
  return Response.json({ ok: true });
});
