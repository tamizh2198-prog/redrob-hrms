import type { PrismaClient } from "@prisma/client";
import { notify } from "../../lib/notify";
import { findDueScheduledReports } from "./service";

// Orchestration only — the "which SavedReports are due, and which of their
// recipients still hold analytics access right now" logic lives on
// findDueScheduledReports() (same split as announcements/reminders.ts and
// helpdesk/escalation.ts).
export async function sendDueScheduledReports(prisma: PrismaClient): Promise<void> {
  const due = await findDueScheduledReports(prisma);

  let sent = 0;
  for (const report of due) {
    for (const recipientId of report.validRecipientIds) {
      await notify(prisma, {
        recipientId,
        template: "analytics.saved-report-ready",
        body: `Your scheduled report "${report.name}" is ready (${report.total} record${report.total === 1 ? "" : "s"}).`,
        data: { savedReportId: report.savedReportId, name: report.name, total: report.total },
      });
      sent++;
    }

    const skipped = report.recipientCount - report.validRecipientIds.length;
    if (skipped > 0) {
      console.warn(`SavedReport ${report.savedReportId} (${report.name}): ${skipped} recipient(s) no longer hold analytics access and were skipped`);
    }
  }

  if (sent > 0) {
    console.log(`Sent ${sent} scheduled analytics report notification(s)`);
  }
}
