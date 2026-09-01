import { withCron } from "@/server/lib/cron";
import { prisma } from "@/server/lib/prisma";
import { sendUnreadReminders } from "@/server/modules/announcements/reminders";

export const GET = withCron(async () => {
  await sendUnreadReminders(prisma);
  return Response.json({ ok: true });
});
