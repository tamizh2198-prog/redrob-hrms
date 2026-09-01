import type { PrismaClient } from "@prisma/client";
import { notify } from "../../lib/notify";
import { findDueReminders } from "./service";

// Business Rule: "Mandatory unread reminder → T+2 days" — orchestration
// only; the "who's still unacknowledged past the window" query and
// idempotent remindedAt-marking live on findDueReminders() (same split as
// analytics/report-scheduler.ts and helpdesk/escalation.ts).
export async function sendUnreadReminders(prisma: PrismaClient): Promise<void> {
  const reminded = await findDueReminders(prisma);

  for (const ack of reminded) {
    await notify(prisma, {
      recipientId: ack.employeeId,
      template: "announcements.reminder",
      body: `Reminder: you haven't acknowledged the announcement "${ack.announcement.title}" yet.`,
      data: { announcementId: ack.announcementId },
    });
  }

  if (reminded.length > 0) {
    console.log(`Sent ${reminded.length} unread announcement reminder(s)`);
  }
}
