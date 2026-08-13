import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Role, WorkMode } from '@prisma/client';
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
      const workMode = officeWeekdays.includes(date.getUTCDay())
        ? WorkMode.OFFICE
        : WorkMode.WORK_FROM_HOME;

      await this.prisma.rosterEntry.upsert({
        where: { employeeId_date: { employeeId, date } },
        update: { workMode },
        create: { employeeId, date, workMode, isWeekOff: false },
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

  async assignRoster(dto: AssignRosterDto, actorRole?: Role) {
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
          const existing = await this.prisma.attendanceRecord.findUnique({
            where: { employeeId_date: { employeeId, date } },
          });
          if (existing?.isLocked && actorRole !== Role.SUPER_ADMIN) {
            throw new ForbiddenException(
              'Roster changes after the attendance lock date require Super Admin override',
            );
          }

          // Only touch workMode when explicitly given, so assigning a shift
          // never silently overwrites a WFO/WFH day HR already set via the
          // per-employee hybrid schedule above.
          await this.prisma.rosterEntry.upsert({
            where: { employeeId_date: { employeeId, date } },
            update: {
              shiftId: dto.shiftId,
              isWeekOff: dto.isWeekOff ?? false,
              ...(dto.workMode ? { workMode: dto.workMode } : {}),
            },
            create: {
              employeeId,
              date,
              shiftId: dto.shiftId,
              isWeekOff: dto.isWeekOff ?? false,
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
}
