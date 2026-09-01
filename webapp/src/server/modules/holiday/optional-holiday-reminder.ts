import type { PrismaClient } from "@prisma/client";
import { notify } from "../../lib/notify";

// Matches the selection-lock cutoff in holiday/service.ts — the reminder
// fires 3 days before that same cutoff.
const REMINDER_DAYS_BEFORE_CUTOFF = 3;
const SELECTION_CUTOFF_DAYS = 7;

// UTC-normalized to match how holiday dates are stored.
function startOfDayOffset(days: number): Date {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() + days);
  return date;
}

export async function notifySelectionWindowClosing(prisma: PrismaClient): Promise<void> {
  const daysUntilHoliday = SELECTION_CUTOFF_DAYS - REMINDER_DAYS_BEFORE_CUTOFF;
  const dayStart = startOfDayOffset(daysUntilHoliday);
  const dayEnd = startOfDayOffset(daysUntilHoliday + 1);

  const optionalHolidays = await prisma.holiday.findMany({
    where: { isOptional: true, date: { gte: dayStart, lt: dayEnd } },
  });

  for (const holiday of optionalHolidays) {
    const employees = await prisma.employee.findMany({
      where: { locationId: holiday.locationId },
      select: { id: true },
    });
    const selected = await prisma.optionalHolidaySelection.findMany({
      where: { holidayId: holiday.id },
      select: { employeeId: true },
    });
    const selectedIds = new Set(selected.map((s) => s.employeeId));

    for (const employee of employees) {
      if (selectedIds.has(employee.id)) continue;
      await notify(prisma, {
        recipientId: employee.id,
        template: "holiday.optional-selection-closing",
        body: `The selection window for the optional holiday "${holiday.name}" closes in ${REMINDER_DAYS_BEFORE_CUTOFF} day(s). Make your selection now.`,
        data: { holidayId: holiday.id, holidayName: holiday.name },
      });
    }
    console.log(`Optional holiday "${holiday.name}" selection reminder sent to ${employees.length - selectedIds.size} employee(s)`);
  }
}
