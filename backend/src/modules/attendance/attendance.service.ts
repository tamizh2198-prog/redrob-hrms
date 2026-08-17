import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AttendanceRecord,
  AttendanceSource,
  AttendanceStatus,
  RequestCommentType,
  Role,
  Shift,
} from '@prisma/client';
import { PrismaService } from '../../shared/database/prisma.service';
import { NotificationService } from '../../shared/notifications/notification.service';
import { CalendarService } from '../../shared/calendar/calendar.service';
import {
  assertCanAccessEmployeeData,
  type EmployeeDataRequester,
} from '../../shared/employee/reporting-hierarchy.util';
import {
  addSuperAdminComment,
  listSuperAdminComments,
} from '../../shared/request-comments/request-comment.util';
import { RegularizeDto } from './dto/regularize.dto';
import { ImportBiometricDto } from './dto/import-biometric.dto';
import { CreateOvertimeClaimDto } from './dto/create-overtime-claim.dto';
import { BulkBiometricRow } from './biometric-import-upload.util';

// Regularization requests must be submitted within this many days of the
// attendance date (Section 7.2 Business Rules: "configurable window").
const REGULARIZATION_WINDOW_DAYS = 7;
// Escalate to HR Admin if the manager hasn't acted within this SLA.
const REGULARIZATION_SLA_HOURS = 48;
// Phase 6D: minimum gap between Punch In and Punch Out, to reject
// unrealistically short work sessions. No prior rule existed for this —
// value confirmed by the business (5 minutes) rather than invented here.
const MIN_PUNCH_INTERVAL_MS = 5 * 60 * 1000;

// Normalizes to UTC midnight, not local midnight — see calendar.service.ts
// for why: date-only ISO strings parse as UTC, so a local boundary here
// would shift every stored date key by a day outside UTC+0 servers.
function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

// Combines a UTC-midnight day key with a shift's "HH:mm" wall-clock time
// using the server's LOCAL hour-setter (deliberately, unlike startOfDay
// above): for positive-UTC-offset locales like IST — this app's actual
// deployment target — UTC midnight of day D is still locally day D, so
// setHours(9, 0) correctly yields "9am local on day D". A deployment west
// of UTC would need real timezone-aware handling (e.g. a per-location IANA
// zone + a library like date-fns-tz) since UTC midnight there falls on the
// previous local day.
function combineDateAndTime(date: Date, hhmm: string): Date {
  const [hours, minutes] = hhmm.split(':').map(Number);
  const combined = new Date(date);
  combined.setHours(hours, minutes, 0, 0);
  return combined;
}

function isPrivileged(role?: Role): boolean {
  return role === Role.HR_ADMIN || role === Role.SUPER_ADMIN;
}

@Injectable()
export class AttendanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
    private readonly calendar: CalendarService,
  ) {}

  // Section 7.2: status is computed against the shift active on that date
  // (grace period, half-day cutoff) — this is what makes Section 7.4's
  // "shifts drive attendance rules" integration point real rather than
  // superficial.
  private computeStatus(
    checkInTime: Date | null,
    checkOutTime: Date | null,
    date: Date,
    shift: Shift | null,
  ): {
    status: AttendanceStatus;
    workHours: number | null;
    overtimeHours: number | null;
  } {
    if (!checkInTime) {
      return {
        status: AttendanceStatus.ABSENT,
        workHours: null,
        overtimeHours: null,
      };
    }
    if (!checkOutTime) {
      return {
        status: AttendanceStatus.PRESENT,
        workHours: null,
        overtimeHours: null,
      };
    }

    const workHours =
      (checkOutTime.getTime() - checkInTime.getTime()) / (1000 * 60 * 60);
    const halfDayHours = shift?.halfDayHours ?? 4.5;

    if (workHours < halfDayHours) {
      return {
        status: AttendanceStatus.HALF_DAY,
        workHours,
        overtimeHours: null,
      };
    }

    let overtimeHours: number | null = null;
    let status: AttendanceStatus = AttendanceStatus.PRESENT;

    if (shift) {
      const shiftStart = combineDateAndTime(date, shift.startTime);
      const shiftEnd = combineDateAndTime(date, shift.endTime);
      const graceMs = shift.graceMinutes * 60 * 1000;

      if (checkInTime.getTime() > shiftStart.getTime() + graceMs) {
        status = AttendanceStatus.LATE;
      } else if (checkOutTime.getTime() < shiftEnd.getTime()) {
        status = AttendanceStatus.EARLY_EXIT;
      }

      if (checkOutTime.getTime() > shiftEnd.getTime()) {
        overtimeHours =
          (checkOutTime.getTime() - shiftEnd.getTime()) / (1000 * 60 * 60);
      }
    }

    return { status, workHours, overtimeHours };
  }

  private async assertNotLocked(
    employeeId: string,
    date: Date,
    actorRole?: Role,
  ) {
    const existing = await this.prisma.attendanceRecord.findUnique({
      where: { employeeId_date: { employeeId, date: startOfDay(date) } },
    });
    if (existing?.isLocked && !isPrivileged(actorRole)) {
      throw new ForbiddenException(
        'This attendance period is locked; only HR Admin/Super Admin can edit it',
      );
    }
  }

  async punch(employeeId: string, type: 'IN' | 'OUT') {
    const now = new Date();
    const date = startOfDay(now);

    const existing = await this.prisma.attendanceRecord.findUnique({
      where: { employeeId_date: { employeeId, date } },
    });

    if (type === 'IN') {
      if (existing?.checkInTime && !existing.checkOutTime) {
        throw new BadRequestException(
          'Already checked in — check out before checking in again',
        );
      }
      return this.prisma.attendanceRecord.upsert({
        where: { employeeId_date: { employeeId, date } },
        update: {
          checkInTime: now,
          checkOutTime: null,
          source: AttendanceSource.WEB,
          status: AttendanceStatus.PRESENT,
        },
        create: {
          employeeId,
          date,
          checkInTime: now,
          source: AttendanceSource.WEB,
          status: AttendanceStatus.PRESENT,
        },
      });
    }

    // type === 'OUT'
    if (!existing?.checkInTime) {
      throw new BadRequestException('Cannot check out before checking in');
    }

    if (
      now.getTime() - existing.checkInTime.getTime() <
      MIN_PUNCH_INTERVAL_MS
    ) {
      throw new BadRequestException(
        'Punch out must be at least 5 minutes after punch in',
      );
    }

    const shift = await this.calendar.getActiveShift(employeeId, date);
    const { status, workHours, overtimeHours } = this.computeStatus(
      existing.checkInTime,
      now,
      date,
      shift,
    );

    return this.prisma.attendanceRecord.update({
      where: { employeeId_date: { employeeId, date } },
      data: { checkOutTime: now, status, workHours, overtimeHours },
    });
  }

  // This task: extended to also return checkInTime/checkOutTime/workHours
  // (already stored on AttendanceRecord, previously dropped from this
  // response) and a per-day regularization summary — so the frontend's
  // Monthly Attendance table can show Check In/Check Out/Duration/Remarks
  // without a second endpoint or re-deriving any of this itself.
  async getCalendar(
    employeeId: string,
    year: number,
    month: number,
    requester: EmployeeDataRequester,
  ) {
    await assertCanAccessEmployeeData(this.prisma, employeeId, requester);
    const from = new Date(Date.UTC(year, month - 1, 1));
    const to = new Date(Date.UTC(year, month, 0));

    const [records, regularizations] = await Promise.all([
      this.prisma.attendanceRecord.findMany({
        where: { employeeId, date: { gte: from, lte: to } },
      }),
      this.prisma.regularizationRequest.findMany({
        where: { employeeId, date: { gte: from, lte: to } },
        include: { decidedBy: { select: { firstName: true, lastName: true } } },
        orderBy: { createdAt: 'desc' },
      }),
    ]);
    const byDate = new Map(
      records.map((r) => [r.date.toISOString().slice(0, 10), r]),
    );
    // orderBy desc + Map.set-once-wins below keeps the MOST RECENT
    // regularization per date if more than one was ever submitted for it.
    const regByDate = new Map<string, (typeof regularizations)[number]>();
    for (const reg of regularizations) {
      const key = reg.date.toISOString().slice(0, 10);
      if (!regByDate.has(key)) regByDate.set(key, reg);
    }

    const days: Array<{
      date: string;
      // This task: widened (not a schema change — this literal never hits
      // the DB) so a day that hasn't happened yet can be reported as
      // "UPCOMING" instead of the misleading ABSENT default below. Every
      // caller of this single shared function — the unified page's Monthly
      // Attendance table and the Employee Profile Attendance section alike
      // — gets the fix for free without touching either of them.
      status: AttendanceStatus | 'UPCOMING';
      checkInTime: Date | null;
      checkOutTime: Date | null;
      workHours: number | null;
      regularization: {
        status: string;
        requestedStatus: AttendanceStatus;
        reason: string;
        decidedByName: string | null;
      } | null;
      // This task: the Holiday row's name, when this day resolves to
      // AttendanceStatus.HOLIDAY — same Holiday lookup CalendarService
      // already uses to decide the status, not a second data source.
      holidayName: string | null;
    }> = [];
    const todayStart = startOfDay(new Date());
    for (let d = new Date(from); d <= to; d.setUTCDate(d.getUTCDate() + 1)) {
      const key = d.toISOString().slice(0, 10);
      const existing = byDate.get(key);
      const reg = regByDate.get(key);
      const regularization = reg
        ? {
            status: reg.status,
            requestedStatus: reg.requestedStatus,
            reason: reg.reason,
            decidedByName: reg.decidedBy
              ? `${reg.decidedBy.firstName} ${reg.decidedBy.lastName}`
              : null,
          }
        : null;
      if (existing) {
        days.push({
          date: key,
          status: existing.status,
          checkInTime: existing.checkInTime,
          checkOutTime: existing.checkOutTime,
          workHours: existing.workHours,
          regularization,
          holidayName: null,
        });
        continue;
      }
      const [holiday, isWeekOff, isWFH] = await Promise.all([
        this.calendar.getHoliday(employeeId, d),
        this.calendar.isWeekOff(employeeId, d),
        this.calendar.isWFH(employeeId, d),
      ]);
      days.push({
        date: key,
        checkInTime: null,
        checkOutTime: null,
        workHours: null,
        regularization,
        holidayName: holiday?.name ?? null,
        status: holiday
          ? AttendanceStatus.HOLIDAY
          : isWeekOff
            ? AttendanceStatus.WEEK_OFF
            : isWFH
              ? AttendanceStatus.WFH
              : // This task: a day later than today hasn't happened yet, so
                // it was never actually "absent" — only the no-record/
                // no-holiday/no-week-off/no-WFH fallback for a future date
                // changes; past and today keep the exact same ABSENT
                // calculation as before.
                d > todayStart
                ? 'UPCOMING'
                : AttendanceStatus.ABSENT,
      });
    }
    return days;
  }

  async regularize(employeeId: string, dto: RegularizeDto) {
    const date = new Date(dto.date);
    const windowEnd = new Date(date);
    windowEnd.setUTCDate(windowEnd.getUTCDate() + REGULARIZATION_WINDOW_DAYS);
    if (new Date() > windowEnd) {
      throw new BadRequestException(
        `Regularization must be submitted within ${REGULARIZATION_WINDOW_DAYS} days of the attendance date`,
      );
    }

    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
    });
    if (!employee) throw new NotFoundException('Employee not found');

    // Regularization is decided by HR Admin, not the reporting manager —
    // Super Admin is notified once decideRegularization() below settles it,
    // but doesn't approve it themselves.
    const approverId = await this.findHrAdminId(employeeId);
    if (!approverId) {
      throw new BadRequestException(
        'No approver is configured for this company — assign an HR Admin first',
      );
    }

    const request = await this.prisma.regularizationRequest.create({
      data: {
        employeeId,
        date: startOfDay(date),
        requestedStatus: dto.requestedStatus,
        requestedCheckInTime: dto.checkInTime,
        requestedCheckOutTime: dto.checkOutTime,
        reason: dto.reason,
        evidenceRef: dto.evidenceRef,
        approverId,
      },
    });

    await this.notifications.send({
      recipientId: approverId,
      template: 'regularization.submitted',
      body: `${employee.firstName} ${employee.lastName} submitted an attendance regularization request for ${startOfDay(date).toISOString().slice(0, 10)}.`,
      data: { requestId: request.id },
    });

    return request;
  }

  async decideRegularization(
    requestId: string,
    actorId: string,
    dto: { approve: boolean; comment?: string },
    actorRole?: Role,
  ) {
    const request = await this.prisma.regularizationRequest.findUnique({
      where: { id: requestId },
    });
    if (!request)
      throw new NotFoundException('Regularization request not found');
    if (request.status !== 'PENDING') {
      throw new BadRequestException('This request was already decided');
    }

    const isAssignedApprover = request.approverId === actorId;
    const isEscalationTarget = isPrivileged(actorRole);
    if (!isAssignedApprover && !isEscalationTarget) {
      throw new ForbiddenException(
        'Only the assigned approver or an HR Admin/Super Admin escalation target can decide this request',
      );
    }

    await this.assertNotLocked(request.employeeId, request.date, actorRole);

    if (dto.approve) {
      // Requested times are optional (e.g. WFH doesn't need one) — an
      // approval with no time still marks the day worked via `status`
      // alone, same as before this field existed.
      const checkInTime = request.requestedCheckInTime
        ? combineDateAndTime(request.date, request.requestedCheckInTime)
        : undefined;
      const checkOutTime = request.requestedCheckOutTime
        ? combineDateAndTime(request.date, request.requestedCheckOutTime)
        : undefined;

      await this.prisma.$transaction([
        this.prisma.attendanceRecord.upsert({
          where: {
            employeeId_date: {
              employeeId: request.employeeId,
              date: request.date,
            },
          },
          update: {
            status: request.requestedStatus,
            ...(checkInTime && { checkInTime }),
            ...(checkOutTime && { checkOutTime }),
          },
          create: {
            employeeId: request.employeeId,
            date: request.date,
            status: request.requestedStatus,
            checkInTime,
            checkOutTime,
          },
        }),
        this.prisma.regularizationRequest.update({
          where: { id: requestId },
          data: { status: 'APPROVED', decidedAt: new Date(), decidedById: actorId },
        }),
      ]);
    } else {
      await this.prisma.regularizationRequest.update({
        where: { id: requestId },
        data: { status: 'REJECTED', decidedAt: new Date(), decidedById: actorId },
      });
    }

    await this.notifications.send({
      recipientId: request.employeeId,
      template: dto.approve
        ? 'regularization.approved'
        : 'regularization.rejected',
      body: `Your attendance regularization request for ${request.date.toISOString().slice(0, 10)} was ${dto.approve ? 'approved' : 'rejected'}.${dto.comment ? ` Comment: "${dto.comment}"` : ''}`,
      data: { comment: dto.comment },
    });

    const decidedEmployee = await this.prisma.employee.findUnique({
      where: { id: request.employeeId },
      select: { firstName: true, lastName: true },
    });
    const decidedEmployeeName = decidedEmployee
      ? `${decidedEmployee.firstName} ${decidedEmployee.lastName}`
      : request.employeeId;
    const superAdminIds = await this.listSuperAdminIds();
    await Promise.all(
      superAdminIds.map((recipientId) =>
        this.notifications.send({
          recipientId,
          template: 'regularization.decided',
          body: `${decidedEmployeeName}'s attendance regularization request for ${request.date.toISOString().slice(0, 10)} (requested status: ${request.requestedStatus}, reason: "${request.reason}") was ${dto.approve ? 'approved' : 'rejected'} by HR Admin.`,
          data: {
            requestId,
            employeeId: request.employeeId,
            date: request.date.toISOString().slice(0, 10),
            requestedStatus: request.requestedStatus,
            approved: dto.approve,
          },
        }),
      ),
    );

    return { status: dto.approve ? 'APPROVED' : 'REJECTED' };
  }

  async importBiometric(dto: ImportBiometricDto) {
    const results: Array<{
      employeeCode: string;
      date: string;
      matched: boolean;
    }> = [];

    for (const row of dto.rows) {
      const employee = await this.prisma.employee.findUnique({
        where: { employeeCode: row.employeeCode },
      });
      if (!employee) {
        results.push({
          employeeCode: row.employeeCode,
          date: row.date,
          matched: false,
        });
        continue;
      }

      const date = startOfDay(new Date(row.date));
      const checkInTime = row.checkInTime ? new Date(row.checkInTime) : null;
      const checkOutTime = row.checkOutTime ? new Date(row.checkOutTime) : null;
      const shift = await this.calendar.getActiveShift(employee.id, date);
      const { status, workHours, overtimeHours } = this.computeStatus(
        checkInTime,
        checkOutTime,
        date,
        shift,
      );

      await this.prisma.attendanceRecord.upsert({
        where: { employeeId_date: { employeeId: employee.id, date } },
        update: {
          checkInTime,
          checkOutTime,
          source: AttendanceSource.BIOMETRIC,
          status,
          workHours,
          overtimeHours,
        },
        create: {
          employeeId: employee.id,
          date,
          checkInTime,
          checkOutTime,
          source: AttendanceSource.BIOMETRIC,
          status,
          workHours,
          overtimeHours,
        },
      });
      results.push({
        employeeCode: row.employeeCode,
        date: row.date,
        matched: true,
      });
    }

    const unmatched = results.filter((r) => !r.matched);
    return {
      totalRows: results.length,
      matchedCount: results.length - unmatched.length,
      unmatchedCount: unmatched.length,
      unmatched,
    };
  }

  // Bulk-upload counterpart to importBiometric() above, for the new
  // Excel-template path (POST /attendance/import/upload) — same
  // employeeCode-matching + computeStatus()/upsert logic, but with
  // per-row validation errors and dry-run support, mirroring the Shift
  // module's bulkSetHybridSchedule(). importBiometric() itself is left
  // untouched: it's still the JSON-paste path's method, with its own
  // matched/unmatched result shape and existing test coverage.
  async bulkImportBiometric(
    rows: BulkBiometricRow[],
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
    const seenEmployeeDateKeys = new Set<string>();

    for (const [index, row] of rows.entries()) {
      const errors: string[] = [];
      if (!row.employeeCode) errors.push('Employee Code is required');
      if (!row.date || Number.isNaN(Date.parse(row.date))) {
        errors.push('Date is missing or invalid');
      }
      if (row.checkInTime && Number.isNaN(Date.parse(row.checkInTime))) {
        errors.push('Check-In Time is invalid');
      }
      if (row.checkOutTime && Number.isNaN(Date.parse(row.checkOutTime))) {
        errors.push('Check-Out Time is invalid');
      }
      if (
        row.checkInTime &&
        row.checkOutTime &&
        !Number.isNaN(Date.parse(row.checkInTime)) &&
        !Number.isNaN(Date.parse(row.checkOutTime)) &&
        new Date(row.checkOutTime).getTime() <=
          new Date(row.checkInTime).getTime()
      ) {
        errors.push('Check-Out Time must be after Check-In Time');
      }

      const dedupeKey = `${row.employeeCode}|${row.date}`;
      if (row.employeeCode && row.date && seenEmployeeDateKeys.has(dedupeKey)) {
        errors.push(
          'Duplicate row for this employee and date already present earlier in this upload',
        );
      }

      if (errors.length > 0) {
        results.push({ row: index, success: false, errors });
        continue;
      }
      seenEmployeeDateKeys.add(dedupeKey);

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
        const date = startOfDay(new Date(row.date));
        const checkInTime = row.checkInTime ? new Date(row.checkInTime) : null;
        const checkOutTime = row.checkOutTime
          ? new Date(row.checkOutTime)
          : null;
        const shift = await this.calendar.getActiveShift(employee.id, date);
        const { status, workHours, overtimeHours } = this.computeStatus(
          checkInTime,
          checkOutTime,
          date,
          shift,
        );

        await this.prisma.attendanceRecord.upsert({
          where: { employeeId_date: { employeeId: employee.id, date } },
          update: {
            checkInTime,
            checkOutTime,
            source: AttendanceSource.BIOMETRIC,
            status,
            workHours,
            overtimeHours,
          },
          create: {
            employeeId: employee.id,
            date,
            checkInTime,
            checkOutTime,
            source: AttendanceSource.BIOMETRIC,
            status,
            workHours,
            overtimeHours,
          },
        });
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

  async lockMonth(year: number, month: number) {
    const from = new Date(Date.UTC(year, month - 1, 1));
    const to = new Date(Date.UTC(year, month, 0));
    const result = await this.prisma.attendanceRecord.updateMany({
      where: { date: { gte: from, lte: to } },
      data: { isLocked: true },
    });
    return { lockedRecords: result.count, year, month };
  }

  // Strips passwordHash off both the requesting employee and the actor who
  // decided the request — same class of bug as the employee-only version
  // this replaces (found live while testing the unified page).
  private stripRegularizationPasswordHashes<
    T extends {
      employee?: Record<string, unknown> | null;
      decidedBy?: Record<string, unknown> | null;
    },
  >(request: T) {
    const safeEmployee = request.employee ? { ...request.employee } : request.employee;
    if (safeEmployee) delete safeEmployee.passwordHash;
    const safeDecidedBy = request.decidedBy ? { ...request.decidedBy } : request.decidedBy;
    if (safeDecidedBy) delete safeDecidedBy.passwordHash;
    return { ...request, employee: safeEmployee, decidedBy: safeDecidedBy };
  }

  async listRegularizations(filter: {
    employeeId?: string;
    approverId?: string;
    status?: 'PENDING' | 'APPROVED' | 'REJECTED';
  }) {
    const requests = await this.prisma.regularizationRequest.findMany({
      where: {
        employeeId: filter.employeeId,
        approverId: filter.approverId,
        status: filter.status,
      },
      include: { employee: true, decidedBy: true },
      orderBy: { createdAt: 'desc' },
    });
    return requests.map((r) => this.stripRegularizationPasswordHashes(r));
  }

  // Company-wide view for HR Admin/Super Admin — listRegularizations() above
  // is always scoped by employeeId/approverId, so an HR Admin who isn't the
  // literal assigned approver on most requests had no way to browse them at
  // all (they can still decide any of them via the isPrivileged escalation
  // path in decideRegularization(), just couldn't see them first).
  async listAllRegularizations(status?: 'PENDING' | 'APPROVED' | 'REJECTED') {
    const requests = await this.prisma.regularizationRequest.findMany({
      where: { status },
      include: { employee: true, decidedBy: true },
      orderBy: { createdAt: 'desc' },
    });
    return requests.map((r) => this.stripRegularizationPasswordHashes(r));
  }

  // Section 1 visibility ask: managers/HR/Super Admin should be able to see
  // which employees actually worked a holiday/week-off, independent of
  // whether that employee has (yet) filed a Comp-Off request for it — a
  // Manager sees their own reports, HR Admin/Super Admin see company-wide.
  async listWorkedOffDays(
    requester: { userId: string; role: string },
    from: Date,
    to: Date,
  ) {
    const isPrivilegedViewer =
      requester.role === Role.HR_ADMIN || requester.role === Role.SUPER_ADMIN;
    const employees = await this.prisma.employee.findMany({
      where: isPrivilegedViewer ? {} : { reportingManagerId: requester.userId },
      select: { id: true, firstName: true, lastName: true, employeeCode: true },
    });
    if (employees.length === 0) return [];
    const employeeById = new Map(employees.map((e) => [e.id, e]));

    const records = await this.prisma.attendanceRecord.findMany({
      where: {
        employeeId: { in: [...employeeById.keys()] },
        date: { gte: startOfDay(from), lte: startOfDay(to) },
        checkInTime: { not: null },
      },
      orderBy: { date: 'desc' },
    });

    const results: Array<{
      employeeId: string;
      employeeName: string;
      employeeCode: string;
      date: string;
      compOffStatus: 'PENDING' | 'APPROVED' | 'REJECTED' | null;
    }> = [];
    for (const record of records) {
      const nonWorking = await this.calendar.isNonWorkingDay(
        record.employeeId,
        record.date,
      );
      if (!nonWorking) continue;

      const compOff = await this.prisma.compOffRequest.findFirst({
        where: { employeeId: record.employeeId, workedDate: record.date },
        select: { status: true },
      });
      const employee = employeeById.get(record.employeeId)!;
      results.push({
        employeeId: record.employeeId,
        employeeName: `${employee.firstName} ${employee.lastName}`,
        employeeCode: employee.employeeCode,
        date: record.date.toISOString().slice(0, 10),
        compOffStatus: compOff?.status ?? null,
      });
    }
    return results;
  }

  // Same "manager, else any HR Admin/Super Admin, else fail explicitly"
  // fallback LeaveService.applyLeave() uses.
  private async findHrAdminId(excludeId?: string): Promise<string | null> {
    const hrAdmin = await this.prisma.employee.findFirst({
      where: {
        role: { in: [Role.HR_ADMIN, Role.SUPER_ADMIN] },
        ...(excludeId && { id: { not: excludeId } }),
      },
    });
    return hrAdmin?.id ?? null;
  }

  // Regularization/Overtime decisions are notify-only for Super Admin —
  // every Super Admin gets the full details once HR Admin/the manager
  // decides, but none of them are required (or, for new claims, able) to
  // act on it themselves.
  private async listSuperAdminIds(): Promise<string[]> {
    const superAdmins = await this.prisma.employee.findMany({
      where: { role: Role.SUPER_ADMIN },
      select: { id: true },
    });
    return superAdmins.map((s) => s.id);
  }

  // Employee-initiated claim for overtime worked on a date — a recorded
  // claim only, matching Regularization's shape. Single-stage approval: the
  // assigned manager's decision is final; every Super Admin is notified
  // with the complete claim details either way, but isn't a second
  // approval gate. Deciding only flips this claim's own status — no
  // AttendanceRecord/LeaveBalance side effect (no auto pay/leave
  // conversion). PENDING_SUPER_ADMIN is kept in the schema only to resolve
  // any claims that reached it before this change — new claims never enter
  // that state.
  async submitOvertimeClaim(employeeId: string, dto: CreateOvertimeClaimDto) {
    const date = startOfDay(new Date(dto.date));
    if (date > startOfDay(new Date())) {
      throw new BadRequestException(
        'Cannot claim overtime for a future date',
      );
    }

    const duplicate = await this.prisma.overtimeClaim.findFirst({
      where: {
        employeeId,
        date,
        status: { in: ['PENDING_MANAGER', 'PENDING_SUPER_ADMIN', 'APPROVED'] },
      },
    });
    if (duplicate) {
      throw new BadRequestException(
        'An overtime claim for this date already exists',
      );
    }

    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
    });
    if (!employee) throw new NotFoundException('Employee not found');

    let approverId = employee.reportingManagerId;
    if (!approverId) {
      approverId = await this.findHrAdminId(employeeId);
      if (!approverId) {
        throw new BadRequestException(
          'No approver is configured for this employee — assign a reporting manager or an HR Admin first',
        );
      }
    }

    const claim = await this.prisma.overtimeClaim.create({
      data: {
        employeeId,
        date,
        hoursClaimed: dto.hoursClaimed,
        reason: dto.reason,
        approverId,
      },
    });

    await this.notifications.send({
      recipientId: approverId,
      template: 'overtime.submitted',
      body: `${employee.firstName} ${employee.lastName} submitted an overtime claim for ${date.toISOString().slice(0, 10)} (${dto.hoursClaimed} hour${dto.hoursClaimed === 1 ? '' : 's'}) and is awaiting your approval.`,
      data: { claimId: claim.id },
    });

    return claim;
  }

  async decideOvertimeClaim(
    claimId: string,
    actorId: string,
    dto: { approve: boolean; comment?: string },
    actorRole?: Role,
  ) {
    const claim = await this.prisma.overtimeClaim.findUnique({
      where: { id: claimId },
      include: { employee: true },
    });
    if (!claim) throw new NotFoundException('Overtime claim not found');

    if (claim.status === 'PENDING_MANAGER') {
      const isAssignedApprover = claim.approverId === actorId;
      if (!isAssignedApprover && !isPrivileged(actorRole)) {
        throw new ForbiddenException(
          'Only the assigned manager or an HR Admin/Super Admin can decide this claim',
        );
      }

      // Single-stage: the manager's decision is final — Super Admin is
      // notified with the complete claim details either way, but isn't a
      // second approval gate (matches Regularization/Comp-off's
      // notify-only pattern for Super Admin).
      const finalStatus = dto.approve ? 'APPROVED' : 'REJECTED';
      await this.prisma.overtimeClaim.update({
        where: { id: claimId },
        data: {
          status: finalStatus,
          managerApproverId: actorId,
          managerDecidedAt: new Date(),
          decidedAt: new Date(),
        },
      });
      await this.notifications.send({
        recipientId: claim.employeeId,
        template: dto.approve ? 'overtime.approved' : 'overtime.rejected',
        body: `Your overtime claim for ${claim.date.toISOString().slice(0, 10)} was ${dto.approve ? 'approved' : 'rejected'}.${dto.comment ? ` Comment: "${dto.comment}"` : ''}`,
        data: { comment: dto.comment },
      });

      const superAdminIds = await this.listSuperAdminIds();
      await Promise.all(
        superAdminIds.map((recipientId) =>
          this.notifications.send({
            recipientId,
            template: 'overtime.decided',
            body: `${claim.employee.firstName} ${claim.employee.lastName} (${claim.employee.employeeCode}) claimed ${claim.hoursClaimed} hour${claim.hoursClaimed === 1 ? '' : 's'} of overtime for ${claim.date.toISOString().slice(0, 10)} — reason: "${claim.reason}". ${dto.approve ? 'Approved' : 'Rejected'} by their manager.`,
            data: {
              claimId,
              employeeId: claim.employeeId,
              date: claim.date.toISOString().slice(0, 10),
              hoursClaimed: claim.hoursClaimed,
              reason: claim.reason,
              approved: dto.approve,
            },
          }),
        ),
      );
      return { status: finalStatus };
    }

    if (claim.status === 'PENDING_SUPER_ADMIN') {
      if (actorRole !== Role.SUPER_ADMIN) {
        throw new ForbiddenException(
          'Only a Super Admin can give final approval for this claim',
        );
      }

      const finalStatus = dto.approve ? 'APPROVED' : 'REJECTED';
      await this.prisma.overtimeClaim.update({
        where: { id: claimId },
        data: { status: finalStatus, decidedAt: new Date() },
      });
      await this.notifications.send({
        recipientId: claim.employeeId,
        template: dto.approve ? 'overtime.approved' : 'overtime.rejected',
        body: `Your overtime claim for ${claim.date.toISOString().slice(0, 10)} was ${dto.approve ? 'approved' : 'rejected'}.${dto.comment ? ` Comment: "${dto.comment}"` : ''}`,
        data: { comment: dto.comment },
      });
      return { status: finalStatus };
    }

    throw new BadRequestException('This claim was already decided');
  }

  listPendingSuperAdminOvertime() {
    return this.listOvertimeClaims({ status: 'PENDING_SUPER_ADMIN' });
  }

  listOvertimeClaims(filter: {
    employeeId?: string;
    approverId?: string;
    status?: 'PENDING_MANAGER' | 'PENDING_SUPER_ADMIN' | 'APPROVED' | 'REJECTED';
  }) {
    return this.prisma.overtimeClaim
      .findMany({
        where: {
          employeeId: filter.employeeId,
          approverId: filter.approverId,
          status: filter.status,
        },
        include: { employee: true },
        orderBy: { createdAt: 'desc' },
      })
      .then((claims) =>
        claims.map((c) => {
          if (!c.employee) return c;
          const safeEmployee: Partial<typeof c.employee> = { ...c.employee };
          delete safeEmployee.passwordHash;
          return { ...c, employee: safeEmployee };
        }),
      );
  }

  async addOvertimeComment(claimId: string, authorId: string, body: string) {
    const claim = await this.prisma.overtimeClaim.findUnique({
      where: { id: claimId },
    });
    if (!claim) throw new NotFoundException('Overtime claim not found');

    const comment = await addSuperAdminComment(this.prisma, {
      requestType: RequestCommentType.OVERTIME,
      requestId: claimId,
      authorId,
      body,
    });

    if (claim.approverId) {
      await this.notifications.send({
        recipientId: claim.approverId,
        template: 'overtime.comment-added',
        body: `A new comment was added to the overtime claim dated ${claim.date.toISOString().slice(0, 10)}: "${body}"`,
        data: { claimId },
      });
    }

    return comment;
  }

  async listOvertimeComments(
    claimId: string,
    actorId: string,
    actorRole?: Role,
  ) {
    const claim = await this.prisma.overtimeClaim.findUnique({
      where: { id: claimId },
    });
    if (!claim) throw new NotFoundException('Overtime claim not found');
    if (claim.approverId !== actorId && !isPrivileged(actorRole)) {
      throw new ForbiddenException(
        'Only the assigned approver or an HR Admin/Super Admin can view these comments',
      );
    }
    return listSuperAdminComments(
      this.prisma,
      RequestCommentType.OVERTIME,
      claimId,
    );
  }

  // Called by LeaveService when a leave application is approved/cancelled —
  // Section 7.3's "Attendance module marks the days 'On Leave'" integration
  // point. Skips holidays/week-offs since those aren't attendance-tracked
  // as leave days (Section 7.5: holidays are never marked Absent or On Leave).
  async syncLeaveStatus(employeeId: string, dates: Date[], onLeave: boolean) {
    for (const rawDate of dates) {
      const date = startOfDay(rawDate);
      const nonWorking = await this.calendar.isNonWorkingDay(employeeId, date);
      if (nonWorking) continue;

      if (onLeave) {
        await this.prisma.attendanceRecord.upsert({
          where: { employeeId_date: { employeeId, date } },
          update: { status: AttendanceStatus.ON_LEAVE },
          create: { employeeId, date, status: AttendanceStatus.ON_LEAVE },
        });
      } else {
        const existing = await this.prisma.attendanceRecord.findUnique({
          where: { employeeId_date: { employeeId, date } },
        });
        if (existing?.status === AttendanceStatus.ON_LEAVE) {
          await this.prisma.attendanceRecord.update({
            where: { employeeId_date: { employeeId, date } },
            data: {
              status: AttendanceStatus.ABSENT,
              checkInTime: null,
              checkOutTime: null,
            },
          });
        }
      }
    }
  }

  async findRecord(
    employeeId: string,
    date: Date,
  ): Promise<AttendanceRecord | null> {
    return this.prisma.attendanceRecord.findUnique({
      where: { employeeId_date: { employeeId, date: startOfDay(date) } },
    });
  }

  async listPendingEscalations() {
    const slaThreshold = new Date();
    slaThreshold.setHours(slaThreshold.getHours() - REGULARIZATION_SLA_HOURS);
    return this.prisma.regularizationRequest.findMany({
      where: { status: 'PENDING', createdAt: { lt: slaThreshold } },
      include: { employee: true },
    });
  }
}
