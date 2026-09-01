import { withCron } from "@/server/lib/cron";
import { prisma } from "@/server/lib/prisma";
import { remindSuperAdmins } from "@/server/modules/settings/backup-reminder";

export const GET = withCron(async () => {
  await remindSuperAdmins(prisma);
  return Response.json({ ok: true });
});
