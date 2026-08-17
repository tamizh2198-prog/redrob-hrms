/**
 * One-off backfill: the demo dashboard's "Today's Attendance" KPI
 * (AnalyticsService.getHrAdminDashboard) reads AttendanceRecord rows dated
 * exactly today. seed-demo-data.ts only ever generates a rolling 90-day
 * window ending on whatever day IT was run — since it's been run on
 * different machine dates over time (attendance rows currently span
 * 2026-05-17 through 2027-03-17 in separate batches), today's actual date
 * fell in the gap between runs and has zero rows, so the KPI shows "—"
 * instead of a real percentage.
 *
 * This creates today's rows for every ACTIVE/ACTIVE_PROBATION employee who
 * doesn't already have one, using the exact same status distribution and
 * check-in/out generation seed-demo-data.ts uses for a normal day (weekend
 * -> WEEK_OFF, holiday -> HOLIDAY, approved leave covering today ->
 * ON_LEAVE, otherwise a weighted PRESENT/WFH/LATE/HALF_DAY/EARLY_EXIT/
 * ABSENT pick) — not a special-cased "make it look good" distribution.
 *
 * Run with DRY_RUN (default) first, then RUN=1 to apply.
 *   npx ts-node prisma/backfill-today-attendance.ts          # DRY RUN
 *   RUN=1 npx ts-node prisma/backfill-today-attendance.ts    # APPLY
 */
import {
  PrismaClient,
  AttendanceStatus,
  AttendanceSource,
  EmployeeStatus,
  LeaveApplicationStatus,
} from '@prisma/client';

const prisma = new PrismaClient();

function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function isWeekend(date: Date): boolean {
  const day = date.getUTCDay();
  return day === 0 || day === 6;
}

function timeOn(date: Date, hour: number, minute: number): Date {
  const d = new Date(date);
  d.setUTCHours(hour, minute, 0, 0);
  return d;
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pick<T>(arr: T[]): T {
  return arr[randomInt(0, arr.length - 1)];
}

function weightedPick<T>(entries: [T, number][]): T {
  const total = entries.reduce((s, [, w]) => s + w, 0);
  let r = Math.random() * total;
  for (const [value, weight] of entries) {
    if (r < weight) return value;
    r -= weight;
  }
  return entries[entries.length - 1][0];
}

const SOURCES: AttendanceSource[] = [
  AttendanceSource.BIOMETRIC,
  AttendanceSource.WEB,
  AttendanceSource.MOBILE,
];

async function main() {
  const apply = process.env.RUN === '1';
  const today = startOfDay(new Date());

  const candidates = await prisma.employee.findMany({
    where: {
      status: { in: [EmployeeStatus.ACTIVE, EmployeeStatus.ACTIVE_PROBATION] },
      attendanceRecords: { none: { date: today } },
    },
    select: { id: true, employeeCode: true, locationId: true },
  });

  console.log(
    `Active employees missing an attendance row for ${today.toISOString().slice(0, 10)}: ${candidates.length}`,
  );

  if (candidates.length === 0) {
    console.log('Nothing to do.');
    return;
  }

  const [holidaysToday, leavesToday] = await Promise.all([
    prisma.holiday.findMany({ where: { date: today } }),
    prisma.leaveApplication.findMany({
      where: {
        status: LeaveApplicationStatus.APPROVED,
        startDate: { lte: today },
        endDate: { gte: today },
      },
      select: { employeeId: true },
    }),
  ]);
  const holidayLocationIds = new Set(holidaysToday.map((h) => h.locationId));
  const onLeaveEmployeeIds = new Set(leavesToday.map((l) => l.employeeId));

  const rows: {
    employeeId: string;
    date: Date;
    checkInTime: Date | null;
    checkOutTime: Date | null;
    source: AttendanceSource | null;
    status: AttendanceStatus;
    workHours: number | null;
    overtimeHours: number | null;
  }[] = [];

  const isTodayWeekend = isWeekend(today);

  for (const emp of candidates) {
    if (isTodayWeekend) {
      rows.push({
        employeeId: emp.id, date: today, checkInTime: null, checkOutTime: null,
        source: null, status: AttendanceStatus.WEEK_OFF, workHours: null, overtimeHours: null,
      });
      continue;
    }
    if (emp.locationId && holidayLocationIds.has(emp.locationId)) {
      rows.push({
        employeeId: emp.id, date: today, checkInTime: null, checkOutTime: null,
        source: null, status: AttendanceStatus.HOLIDAY, workHours: null, overtimeHours: null,
      });
      continue;
    }
    if (onLeaveEmployeeIds.has(emp.id)) {
      rows.push({
        employeeId: emp.id, date: today, checkInTime: null, checkOutTime: null,
        source: null, status: AttendanceStatus.ON_LEAVE, workHours: null, overtimeHours: null,
      });
      continue;
    }

    const status = weightedPick<AttendanceStatus>([
      [AttendanceStatus.PRESENT, 63],
      [AttendanceStatus.WFH, 15],
      [AttendanceStatus.LATE, 9],
      [AttendanceStatus.HALF_DAY, 4],
      [AttendanceStatus.EARLY_EXIT, 3],
      [AttendanceStatus.ABSENT, 6],
    ]);

    if (status === AttendanceStatus.ABSENT) {
      rows.push({
        employeeId: emp.id, date: today, checkInTime: null, checkOutTime: null,
        source: null, status, workHours: null, overtimeHours: null,
      });
      continue;
    }

    let checkInHour = 9, checkInMin = randomInt(0, 45);
    let checkOutHour = 18, checkOutMin = randomInt(0, 45);
    if (status === AttendanceStatus.LATE) { checkInHour = 10; checkInMin = randomInt(15, 55); }
    if (status === AttendanceStatus.EARLY_EXIT) { checkOutHour = 15; checkOutMin = randomInt(0, 30); }
    if (status === AttendanceStatus.HALF_DAY) { checkOutHour = 13; checkOutMin = randomInt(0, 30); }

    const checkInTime = timeOn(today, checkInHour, checkInMin);
    const checkOutTime = timeOn(today, checkOutHour, checkOutMin);
    const workHours = Math.round(((checkOutTime.getTime() - checkInTime.getTime()) / 3600000) * 10) / 10;

    rows.push({
      employeeId: emp.id,
      date: today,
      checkInTime,
      checkOutTime,
      source: status === AttendanceStatus.WFH ? AttendanceSource.WEB : pick(SOURCES),
      status,
      workHours,
      overtimeHours: workHours > 9 ? Math.round((workHours - 9) * 10) / 10 : 0,
    });
  }

  const byStatus = rows.reduce<Record<string, number>>((acc, r) => {
    acc[r.status] = (acc[r.status] ?? 0) + 1;
    return acc;
  }, {});
  console.log('Distribution to create:', byStatus);

  if (!apply) {
    console.log('\nDRY RUN only — no changes written. Re-run with RUN=1 to apply.');
    return;
  }

  const result = await prisma.attendanceRecord.createMany({
    data: rows,
    skipDuplicates: true,
  });
  console.log(`Done. Created ${result.count} attendance record(s) for today.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
