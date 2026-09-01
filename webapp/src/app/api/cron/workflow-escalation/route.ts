import { withCron } from "@/server/lib/cron";
import { prisma } from "@/server/lib/prisma";
import { escalateBreachedSteps } from "@/server/modules/workflow/escalation";

export const GET = withCron(async () => {
  await escalateBreachedSteps(prisma);
  return Response.json({ ok: true });
});
