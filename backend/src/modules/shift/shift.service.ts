import { Injectable, NotFoundException } from '@nestjs/common';
import { WorkMode } from '@prisma/client';
import { PrismaService } from '../../shared/database/prisma.service';
import { DefaultCompanyService } from '../../shared/database/default-company.service';
import { NotificationService } from '../../shared/notifications/notification.service';
import { CreateShiftDto } from './dto/create-shift.dto';
import { AssignRosterDto } from './dto/assign-roster.dto';
import { SetHybridScheduleDto } from './dto/set-hybrid-schedule.dto';
import { BulkHybridScheduleRow } from './hybrid-schedule-upload.util';
import {
  assertCanAccessEmployeeData,
  type EmployeeDataRequester,
} from '../../shared/employee/reporting-hierarchy.util';

// Normalizes to UTC midnight, not local midnight — see calendar.service.ts
// for why: date-only ISO strings parse as UTC, so a local boundary here
// would shift every stored date key by a day outside UTC+0 servers.
function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

// Company-wide default (see calendar.service.ts's isWeekOff): Saturday and
// Sunday are week-off unless a caller explicitly says otherwise.
function isWeekendDate(date: Date): boolean {
  const day = date.getUTCDay();
  return day === 0 || day === 6;
}

@Injectable()
export class ShiftService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly defaultCompany: DefaultCompanyService,
    private readonly notifications: NotificationService,
  ) {}

  async createShift(dto: CreateShiftDto) {
    const companyId =
      dto.companyId ?? (await this.defaultCompany.getOrCreate());
    return this.prisma.shift.create({
      data: {
        companyId,
        name: dto.name,
        startTime: dto.startTime,
        endTime: dto.endTime,
        graceMinutes: dto.graceMinutes ?? 0,
        halfDayHours: dto.halfDayHours ?? 4.5,
        isNightShift: dto.isNightShift ?? false,
      },
    });
  }

  listShifts() {
    return this.prisma.shift.findMany({ orderBy: { name: 'asc' } });
  }

  // Section 7.4: HR assigns each employee's own office weekdays for the
  // month — there is no single company-wide pattern, since different
  // employees/teams come into the office on different days. Shared by the
  // single-employee endpoint and the bulk-upload path below, so every route
  // that sets a hybrid schedule also regenerates that month's RosterEntry
  // rows the same way — the employee's own roster view is never out of
  // sync with what HR just set.
  private async applyHybridSchedule(
    employeeId: string,
    year: number,
    month: number,
    officeWeekdaysRaw: number[],
  ): Promise<{ officeWeekdays: number[]; daysUpdated: number }> {
    const officeWeekdays = [...new Set(officeWeekdaysRaw)];

    await this.prisma.employeeHybridSchedule.upsert({
      where: { employeeId_year_month: { employeeId, year, month } },
      update: { officeWeekdays },
      create: { employeeId, year, month, officeWeekdays },
    });

    const monthStart = new Date(Date.UTC(year, month - 1, 1));
    const monthEnd = new Date(Date.UTC(year, month, 0));

    let daysUpdated = 0;
    for (
      let d = new Date(monthStart);
      d <= monthEnd;
      d.setUTCDate(d.getUTCDate() + 1)
    ) {
      const date = new Date(d);
      const isWeekOff = isWeekendDate(date);
      const workMode = officeWeekdays.includes(date.getUTCDay())
        ? WorkMode.OFFICE
        : WorkMode.WORK_FROM_HOME;

      await this.prisma.rosterEntry.upsert({
        where: { employeeId_date: { employeeId, date } },
        update: { workMode, isWeekOff },
        create: { employeeId, date, workMode, isWeekOff },
      });
      daysUpdated++;
    }

    return { officeWeekdays, daysUpdated };
  }

  async setEmployeeHybridSchedule(dto: SetHybridScheduleDto) {
    const employee = await this.prisma.employee.findUnique({
      where: { id: dto.employeeId },
    });
    if (!employee) throw new NotFoundException('Employee not found');

    return this.applyHybridSchedule(
      dto.employeeId,
      dto.year,
      dto.month,
      dto.officeWeekdays,
    );
  }

  // Bulk-upload counterpart: one spreadsheet row per employee, each with
  // its own office-weekday pattern for the month — HR no longer has to
  // repeat the single-employee flow one person at a time.
  async bulkSetHybridSchedule(
    rows: BulkHybridScheduleRow[],
    dryRun: boolean,
  ): Promise<{
    totalRows: number;
    successCount: number;
    failureCount: number;
    dryRun: boolean;
    results: Array<{
      row: number;
      success: boolean;
      employeeId?: string;
      errors?: string[];
    }>;
  }> {
    const results: Array<{
      row: number;
      success: boolean;
      employeeId?: string;
      errors?: string[];
    }> = [];

    for (const [index, row] of rows.entries()) {
      const errors: string[] = [];
      if (!row.employeeCode) errors.push('Employee Code is required');
      if (!row.year || row.year < 2000) errors.push('Year is invalid');
      if (!row.month || row.month < 1 || row.month > 12) {
        errors.push('Month must be between 1 and 12');
      }
      if (row.officeWeekdays.length === 0) {
        errors.push('At least one office weekday must be selected');
      }
      if (errors.length > 0) {
        results.push({ row: index, success: false, errors });
        continue;
      }

      const employee = await this.prisma.employee.findUnique({
        where: { employeeCode: row.employeeCode },
      });
      if (!employee) {
        results.push({
          row: index,
          success: false,
          errors: [`No employee found with code "${row.employeeCode}"`],
        });
        continue;
      }

      if (!dryRun) {
        await this.applyHybridSchedule(
          employee.id,
          row.year,
          row.month,
          row.officeWeekdays,
        );
      }
      results.push({ row: index, success: true, employeeId: employee.id });
    }

    return {
      totalRows: rows.length,
      successCount: results.filter((r) => r.success).length,
      failureCount: results.filter((r) => !r.success).length,
      dryRun,
      results,
    };
  }

  async getEmployeeHybridSchedule(
    employeeId: string,
    year: number,
    month: number,
    requester: EmployeeDataRequester,
  ) {
    await assertCanAccessEmployeeData(this.prisma, employeeId, requester);
    const schedule = await this.prisma.employeeHybridSchedule.findUnique({
      where: { employeeId_year_month: { employeeId, year, month } },
    });
    return { officeWeekdays: schedule?.officeWeekdays ?? [] };
  }

  async assignRoster(dto: AssignRosterDto) {
    if (dto.shiftId) {
      const shift = await this.prisma.shift.findUnique({
        where: { id: dto.shiftId },
      });
      if (!shift) throw new NotFoundException('Shift not found');
    }

    const results: Array<{
      employeeId: string;
      date: string;
      success: boolean;
      error?: string;
    }> = [];

    for (const employeeId of dto.employeeIds) {
      for (const dateStr of dto.dates) {
        const date = startOfDay(new Date(dateStr));
        try {
          // Only touch workMode when explicitly given, so assigning a shift
          // never silently overwrites a WFO/WFH day HR already set via the
          // per-employee hybrid schedule above. isWeekOff defaults to the
          // company-wide Saturday/Sunday rule when not explicitly given —
          // HR can still override it in either direction (e.g. dto.isWeekOff:
          // false to deliberately schedule someone to work a weekend).
          const defaultIsWeekOff = isWeekendDate(date);
          await this.prisma.rosterEntry.upsert({
            where: { employeeId_date: { employeeId, date } },
            update: {
              shiftId: dto.shiftId,
              isWeekOff: dto.isWeekOff ?? defaultIsWeekOff,
              ...(dto.workMode ? { workMode: dto.workMode } : {}),
            },
            create: {
              employeeId,
              date,
              shiftId: dto.shiftId,
              isWeekOff: dto.isWeekOff ?? defaultIsWeekOff,
              workMode: dto.workMode ?? WorkMode.OFFICE,
            },
          });
          results.push({ employeeId, date: dateStr, success: true });
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Unknown error';
          results.push({
            employeeId,
            date: dateStr,
            success: false,
            error: message,
          });
        }
      }
    }

    const succeededEmployeeIds = [
      ...new Set(results.filter((r) => r.success).map((r) => r.employeeId)),
    ];
    await Promise.all(
      succeededEmployeeIds.map((employeeId) =>
        this.notifications.send({
          recipientId: employeeId,
          template: 'roster.published',
          body: `Your roster has been published for ${dto.dates.length} day${dto.dates.length === 1 ? '' : 's'} (${[...dto.dates].sort()[0]} to ${[...dto.dates].sort().slice(-1)[0]}).`,
        }),
      ),
    );

    return {
      totalAssignments: results.length,
      successCount: results.filter((r) => r.success).length,
      failureCount: results.filter((r) => !r.success).length,
      results,
    };
  }

  async getRoster(
    employeeId: string,
    from: Date,
    to: Date,
    requester: EmployeeDataRequester,
  ) {
    await assertCanAccessEmployeeData(this.prisma, employeeId, requester);
    return this.prisma.rosterEntry.findMany({
      where: {
        employeeId,
        date: { gte: startOfDay(from), lte: startOfDay(to) },
      },
      include: { shift: true },
      orderBy: { date: 'asc' },
    });
  }

  // One-off backfill (same logic as prisma/backfill-weekend-week-off.ts),
  // exposed as an admin-triggered endpoint rather than a CLI script — lets
  // Super Admin fix pre-existing RosterEntry rows generated by the old
  // "hybrid schedule marks every day Office/WFH regardless of weekday" bug,
  // without needing direct database network access (this service already
  // has that, being the app itself). Excludes any (employeeId, date) that's
  // the compensatory date of an approved WfoWfhChangeRequest — that
  // isWeekOff: false is a deliberate, approved decision to work that
  // weekend, not a leftover from the bug.
  async backfillWeekendWeekOff(dryRun: boolean) {
    const rows = await this.prisma.$queryRaw<
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

    if (dryRun || rows.length === 0) {
      return {
        dryRun: true,
        affectedCount: rows.length,
        sample: rows.slice(0, 10).map((r) => ({
          employeeId: r.employeeId,
          date: r.date.toISOString().slice(0, 10),
        })),
      };
    }

    const result = await this.prisma.rosterEntry.updateMany({
      where: { id: { in: rows.map((r) => r.id) } },
      data: { isWeekOff: true },
    });
    return { dryRun: false, updatedCount: result.count };
  }
}
