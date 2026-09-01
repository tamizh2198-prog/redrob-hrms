import { withCron } from "@/server/lib/cron";
import { prisma } from "@/server/lib/prisma";
import { checkSlaTimers } from "@/server/modules/helpdesk/escalation";

export const GET = withCron(async () => {
  await checkSlaTimers(prisma);
  return Response.json({ ok: true });
});
