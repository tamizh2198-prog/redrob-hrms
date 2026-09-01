import { withCron } from "@/server/lib/cron";
import { prisma } from "@/server/lib/prisma";
import { notifyExpiringDocuments } from "@/server/modules/employee/document-expiry";

export const GET = withCron(async () => {
  await notifyExpiringDocuments(prisma);
  return Response.json({ ok: true });
});
