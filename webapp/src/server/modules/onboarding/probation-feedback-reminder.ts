import type { PrismaClient } from "@prisma/client";
import { notify } from "../../lib/notify";
import { PROBATION_CHECKPOINT_DAYS } from "./service";

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

// Each checkpoint (day 30/60/90) fires independently and exactly once —
// reminderSentAt is the per-occurrence guard, same shape as Ticket's
// slaWarningNotifiedAt/slaBreachedAt in helpdesk/service.ts's runSlaSweep(),
// rather than a sliding-window check (that only works for a single,
// one-time nudge, not a repeating series).
export async function sendDueReminders(prisma: PrismaClient): Promise<void> {
  const due = await prisma.probationFeedback.findMany({
    where: { reminderSentAt: null },
    include: { employee: true },
  });

  const now = new Date();
  let sent = 0;
  for (const feedback of due) {
    const { employee } = feedback;
    if (!employee.dateOfJoining) continue;
    // They're gone — nothing left to ask.
    if (employee.status === "TERMINATED") continue;

    const dueDate = addDays(employee.dateOfJoining, PROBATION_CHECKPOINT_DAYS[feedback.checkpoint]);
    if (now < dueDate) continue;

    await prisma.probationFeedback.update({ where: { id: feedback.id }, data: { reminderSentAt: now } });
    await notify(prisma, {
      recipientId: employee.id,
      template: "onboarding.probation-feedback-due",
      body: "You're a little further into your journey with us — share quick feedback on the company and work culture so far.",
      data: { feedbackId: feedback.id, checkpoint: feedback.checkpoint },
    });
    sent++;
  }

  if (sent > 0) {
    console.log(`Sent ${sent} probation-feedback reminder(s)`);
  }
}
