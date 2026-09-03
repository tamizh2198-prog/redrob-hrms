import type { PrismaClient } from "@prisma/client";
import { notify } from "../../lib/notify";

const DUE_OFFSET_DAYS = 30;

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

// dispatch() treats a placeholder recipientId like "hr-admin" as a silent
// no-op — fan out to real HR staff instead (same fix applied to the
// offboarding LWD sweep).
async function listHrStaffIds(prisma: PrismaClient): Promise<string[]> {
  const staff = await prisma.employee.findMany({
    where: { role: { in: ["HR_ADMIN", "HR_ASSOCIATE", "SUPER_ADMIN"] } },
    select: { id: true },
  });
  return staff.map((s) => s.id);
}

// Joining Kit and ID Card are due a fixed 30 days after joining —
// Confirmation Hamper has no fixed offset (probation length varies) and is
// instead flipped by employee/service.ts's confirmEmployee action, so it's
// deliberately excluded here.
export async function sendDueReminders(prisma: PrismaClient): Promise<void> {
  const due = await prisma.newJoinerTracker.findMany({
    where: { status: "PENDING", item: { in: ["JOINING_KIT", "ID_CARD"] } },
    include: { employee: true },
  });
  if (due.length === 0) return;

  const hrStaffIds = await listHrStaffIds(prisma);
  const now = new Date();
  let sent = 0;
  for (const tracker of due) {
    const { employee } = tracker;
    if (!employee.dateOfJoining) continue;
    if (employee.status === "TERMINATED") continue;

    const dueDate = addDays(employee.dateOfJoining, DUE_OFFSET_DAYS);
    if (now < dueDate) continue;

    await prisma.newJoinerTracker.update({ where: { id: tracker.id }, data: { status: "ASSIGNED", assignedAt: now } });
    await Promise.all(
      hrStaffIds.map((recipientId) =>
        notify(prisma, {
          recipientId,
          template: "onboarding.new-joiner-tracker-due",
          body: `${tracker.item === "JOINING_KIT" ? "Joining kit" : "ID card"} is due for ${employee.firstName} ${employee.lastName} — please arrange and mark it complete.`,
          data: { trackerId: tracker.id, employeeId: employee.id, item: tracker.item },
        }),
      ),
    );
    sent++;
  }

  if (sent > 0) {
    console.log(`Assigned ${sent} new-joiner-tracker item(s)`);
  }
}
