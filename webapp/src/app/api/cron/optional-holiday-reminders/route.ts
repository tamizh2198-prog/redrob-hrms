import { withCron } from "@/server/lib/cron";
import { prisma } from "@/server/lib/prisma";
import { notifySelectionWindowClosing } from "@/server/modules/holiday/optional-holiday-reminder";

export const GET = withCron(async () => {
  await notifySelectionWindowClosing(prisma);
  return Response.json({ ok: true });
});
