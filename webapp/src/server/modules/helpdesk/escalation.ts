import type { PrismaClient } from "@prisma/client";
import { notify } from "../../lib/notify";
import { runSlaSweep } from "./service";

// Business Rule: "SLA breach automatically escalates to the category's
// designated HR Admin/lead" — orchestration only; the actual "who's
// overdue" query and idempotent timestamp-marking live on runSlaSweep()
// (same split as analytics/report-scheduler.ts and
// announcements/reminders.ts).
export async function checkSlaTimers(prisma: PrismaClient): Promise<void> {
  const { warnings, breaches } = await runSlaSweep(prisma);

  for (const { ticket, escalationContactId } of warnings) {
    const recipients = new Set([ticket.assignedAgentId ?? "hr-admin", escalationContactId]);
    for (const recipientId of recipients) {
      await notify(prisma, {
        recipientId,
        template: "helpdesk.sla-warning",
        body: `Ticket "${ticket.subject}" is at 80% of its SLA window and needs attention soon.`,
        data: { ticketId: ticket.id },
      });
    }
  }

  for (const { ticket, escalationContactId } of breaches) {
    const recipients = new Set([ticket.assignedAgentId ?? "hr-admin", escalationContactId]);
    for (const recipientId of recipients) {
      await notify(prisma, {
        recipientId,
        template: "helpdesk.sla-breached",
        body: `Ticket "${ticket.subject}" has breached its SLA and needs immediate attention.`,
        data: { ticketId: ticket.id },
      });
    }
  }

  if (warnings.length > 0 || breaches.length > 0) {
    console.log(`SLA sweep: ${warnings.length} warning(s), ${breaches.length} breach(es)`);
  }
}
