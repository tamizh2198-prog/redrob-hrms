import type { PrismaClient } from "@prisma/client";
import { notify } from "../../lib/notify";

const REMINDER_WINDOWS_DAYS = [30, 15, 7];

// UTC-normalized: document expiryDate values come from date-only input,
// which parses as UTC — a local boundary here would drift the reminder
// window off by a day outside UTC+0 servers.
function startOfDayOffset(days: number): Date {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() + days);
  return date;
}

export async function notifyExpiringDocuments(prisma: PrismaClient): Promise<void> {
  for (const days of REMINDER_WINDOWS_DAYS) {
    const dayStart = startOfDayOffset(days);
    const dayEnd = startOfDayOffset(days + 1);

    const documents = await prisma.employeeDocument.findMany({
      where: { expiryDate: { gte: dayStart, lt: dayEnd } },
      include: { employee: true },
    });

    for (const doc of documents) {
      await notify(prisma, {
        recipientId: doc.employeeId,
        template: "document.expiring",
        body: `Your ${doc.docType} document is expiring in ${days} day${days === 1 ? "" : "s"}. Please renew and re-upload it.`,
        data: { docType: doc.docType, daysRemaining: days },
      });
      await notify(prisma, {
        recipientId: "hr-admin",
        template: "document.expiring",
        body: `${doc.employee.firstName} ${doc.employee.lastName}'s ${doc.docType} document is expiring in ${days} day${days === 1 ? "" : "s"}.`,
        data: { employeeId: doc.employeeId, docType: doc.docType, daysRemaining: days },
      });
    }

    if (documents.length > 0) {
      console.log(`${documents.length} document(s) expiring in ${days} days notified`);
    }
  }
}
