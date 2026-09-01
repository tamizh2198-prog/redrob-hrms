import type { PrismaClient } from "@prisma/client";
import { notify } from "../../lib/notify";
import { computeProfileCompletion } from "./profile-completion";

const REMINDER_DELAY_HOURS = 24;

// Employees added to the HRMS who still haven't finished their profile 24
// hours later get nudged, and so does HR Admin so someone can follow up.
// Runs hourly and only looks at the 1-hour-wide window that just crossed
// the 24h mark, so each employee is caught exactly once instead of being
// re-notified every run.
export async function remindIncompleteProfiles(prisma: PrismaClient): Promise<void> {
  const now = new Date();
  const windowEnd = new Date(now.getTime() - REMINDER_DELAY_HOURS * 60 * 60 * 1000);
  const windowStart = new Date(windowEnd.getTime() - 60 * 60 * 1000);

  const candidates = await prisma.employee.findMany({
    where: { createdAt: { gte: windowStart, lt: windowEnd } },
  });

  let remindersSent = 0;
  for (const employee of candidates) {
    if (computeProfileCompletion(employee).isComplete) continue;

    await notify(prisma, {
      recipientId: employee.id,
      template: "profile-completion.reminder",
      body: "Your profile is still incomplete. Please finish filling in your details.",
    });

    const hrAdmins = await prisma.employee.findMany({
      where: { companyId: employee.companyId, role: "HR_ADMIN" },
      select: { id: true },
    });
    for (const admin of hrAdmins) {
      await notify(prisma, {
        recipientId: admin.id,
        template: "profile-completion.reminder",
        body: `${employee.firstName} ${employee.lastName} still hasn't completed their profile 24 hours after joining.`,
        data: { employeeId: employee.id },
      });
    }
    remindersSent++;
  }

  if (remindersSent > 0) {
    console.log(`Sent ${remindersSent} profile-completion reminder(s) (24h past joining)`);
  }
}
