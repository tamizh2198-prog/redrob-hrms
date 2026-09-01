import type { PrismaClient } from "@prisma/client";
import { notify } from "../../lib/notify";

// Pilot-launch basic backup (GET /settings/backup) is on-demand only —
// nothing runs it automatically, since there's nowhere durable to store the
// result without added cloud storage. This is the other half of "basic
// backup": a standing weekly nudge so downloading a fresh one doesn't get
// forgotten.
export async function remindSuperAdmins(prisma: PrismaClient): Promise<void> {
  const superAdmins = await prisma.employee.findMany({
    where: { role: "SUPER_ADMIN" },
    select: { id: true },
  });
  for (const admin of superAdmins) {
    await notify(prisma, {
      recipientId: admin.id,
      template: "settings.backup-reminder",
      body: "Weekly reminder: download a fresh database backup from Settings to keep your disaster-recovery copy current.",
    });
  }
  if (superAdmins.length > 0) {
    console.log(`Sent ${superAdmins.length} weekly backup reminder(s)`);
  }
}
