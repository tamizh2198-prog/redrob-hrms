import { withCron } from "@/server/lib/cron";
import { prisma } from "@/server/lib/prisma";
import { pruneRateLimitAttempts } from "@/server/lib/rate-limit";

// HRMS-20: RateLimitAttempt rows were only ever inserted (login, MFA,
// forgot-password, and the unauthenticated public careers-page application
// endpoint all write one per call). Runs daily to bound that table's growth.
export const GET = withCron(async () => {
  const { deletedCount } = await pruneRateLimitAttempts(prisma);
  return Response.json({ ok: true, deletedCount });
});
