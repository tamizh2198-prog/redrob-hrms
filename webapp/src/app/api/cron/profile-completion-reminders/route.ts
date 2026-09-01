import { withCron } from "@/server/lib/cron";
import { prisma } from "@/server/lib/prisma";
import { remindIncompleteProfiles } from "@/server/modules/employee/profile-completion-reminder";

export const GET = withCron(async () => {
  await remindIncompleteProfiles(prisma);
  return Response.json({ ok: true });
});
