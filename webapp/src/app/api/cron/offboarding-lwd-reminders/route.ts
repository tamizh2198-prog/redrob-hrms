import { withCron } from "@/server/lib/cron";
import { prisma } from "@/server/lib/prisma";
import { sendDueReminders } from "@/server/modules/offboarding/lwd-reminder";

export const GET = withCron(async () => {
  await sendDueReminders(prisma);
  return Response.json({ ok: true });
});
