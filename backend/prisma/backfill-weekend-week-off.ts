/**
 * One-off backfill: company-wide policy is that every Saturday and Sunday
 * is a week-off (see CalendarService.isWeekOff() and ShiftService's
 * applyHybridSchedule()/assignRoster(), which now generate weekends this
 * way going forward). Existing RosterEntry rows created before that fix —
 * mainly from ShiftService.applyHybridSchedule(), which used to mark every
 * day of the month OFFICE/WORK_FROM_HOME regardless of weekday — still have
 * isWeekOff: false on Saturdays/Sundays. This corrects those rows so the
 * "My Roster" view and every isWeekOff() consumer (Attendance calendar,
 * Leave day-counting, Comp-Off eligibility) agree with the live data too,
 * not just with dates that have no RosterEntry row at all.
 *
 * Run with DRY_RUN (default) first, then RUN=1 to apply.
 *   npx ts-node prisma/backfill-weekend-week-off.ts          # DRY RUN
 *   RUN=1 npx ts-node prisma/backfill-weekend-week-off.ts    # APPLY
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const apply = process.env.RUN === '1';

  // Excludes any (employeeId, date) that's the compensatory date of an
  // approved WfoWfhChangeRequest — that isWeekOff: false is a deliberate,
  // approved decision to work that weekend in exchange for another day off,
  // not a leftover from the old always-false hybrid-schedule generation bug.
  const rows = await prisma.$queryRaw<
    { id: string; employeeId: string; date: Date }[]
  >`
    SELECT re.id, re."employeeId", re.date FROM "RosterEntry" re
    WHERE EXTRACT(DOW FROM re.date) IN (0, 6) AND re."isWeekOff" = false
      AND NOT EXISTS (
        SELECT 1 FROM "WfoWfhChangeRequest" w
        WHERE w."employeeId" = re."employeeId"
          AND w."compensatoryDate" = re.date
          AND w.status = 'APPROVED'
      )
  `;

  console.log(
    `RosterEntry rows on a Saturday/Sunday not marked week-off: ${rows.length}`,
  );

  if (rows.length === 0) {
    console.log('Nothing to do.');
    return;
  }

  if (!apply) {
    console.log('\nSample of affected rows:');
    for (const r of rows.slice(0, 10)) {
      console.log(`  ${r.id} — employee ${r.employeeId} — ${r.date.toISOString().slice(0, 10)}`);
    }
    if (rows.length > 10) console.log(`  ...and ${rows.length - 10} more`);
    console.log('\nDRY RUN only — no changes written. Re-run with RUN=1 to apply.');
    return;
  }

  const result = await prisma.rosterEntry.updateMany({
    where: { id: { in: rows.map((r) => r.id) } },
    data: { isWeekOff: true },
  });
  console.log(`Done. Updated ${result.count} row(s) to isWeekOff: true.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
