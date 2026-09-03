import type { PrismaClient } from "@prisma/client";
import { notify } from "../../lib/notify";

// dispatch() treats any recipientId that isn't a real employee id as a
// silent no-op (the "hr-admin" placeholder used elsewhere in this codebase
// never actually reaches anyone) — this genuinely needs to land on a real
// Super Admin, so fan out to every real Super Admin employee instead of
// reusing that dead-placeholder convention.
async function listSuperAdminIds(prisma: PrismaClient): Promise<string[]> {
  const admins = await prisma.employee.findMany({ where: { role: "SUPER_ADMIN" }, select: { id: true } });
  return admins.map((a) => a.id);
}

// lwdNotificationSentAt is the per-occurrence guard, same shape as
// ProbationFeedback.reminderSentAt — fires the Super Admin nudge exactly
// once per resignation, the day its last working day arrives.
export async function sendDueReminders(prisma: PrismaClient): Promise<void> {
  const due = await prisma.resignation.findMany({
    where: { lwdNotificationSentAt: null, status: { in: ["CLEARANCE_IN_PROGRESS", "CLEARED"] } },
    include: { employee: true },
  });
  if (due.length === 0) return;

  const superAdminIds = await listSuperAdminIds(prisma);
  const now = new Date();
  let sent = 0;
  for (const resignation of due) {
    if (now < resignation.lastWorkingDay) continue;

    await prisma.resignation.update({ where: { id: resignation.id }, data: { lwdNotificationSentAt: now } });
    await Promise.all(
      superAdminIds.map((recipientId) =>
        notify(prisma, {
          recipientId,
          template: "offboarding.lwd-reached",
          body: `${resignation.employee.firstName} ${resignation.employee.lastName}'s last working day has arrived — please review and send the relieving/experience letter.`,
          data: { resignationId: resignation.id, employeeId: resignation.employeeId },
        }),
      ),
    );
    sent++;
  }

  if (sent > 0) {
    console.log(`Sent ${sent} LWD-reached reminder(s)`);
  }
}
