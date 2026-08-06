import { Injectable } from '@nestjs/common';
import { Holiday, RosterEntry, Shift } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';

// Normalizes to UTC midnight, not local midnight: date-only ISO strings
// ("2026-03-02") are parsed as UTC by JS, so any local-timezone boundary
// here would silently shift every date key by a day outside UTC+0 servers.
function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

// Shared by Attendance and Leave so "what kind of day is this for this
// employee" is answered exactly once (Section 10: holidays/rosters are read
// at computation time by both modules — this is that single read path).
@Injectable()
export class CalendarService {
  constructor(private readonly prisma: PrismaService) {}

  async getHoliday(employeeId: string, date: Date): Promise<Holiday | null> {
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      select: { locationId: true },
    });
    if (!employee?.locationId) return null;

    return this.prisma.holiday.findFirst({
      where: { locationId: employee.locationId, date: startOfDay(date) },
    });
  }

  async isHoliday(employeeId: string, date: Date): Promise<boolean> {
    return (await this.getHoliday(employeeId, date)) !== null;
  }

  async getRosterEntry(
    employeeId: string,
    date: Date,
  ): Promise<(RosterEntry & { shift: Shift | null }) | null> {
    return this.prisma.rosterEntry.findUnique({
      where: { employeeId_date: { employeeId, date: startOfDay(date) } },
      include: { shift: true },
    });
  }

  async isWeekOff(employeeId: string, date: Date): Promise<boolean> {
    const entry = await this.getRosterEntry(employeeId, date);
    return entry?.isWeekOff ?? false;
  }

  async isWFH(employeeId: string, date: Date): Promise<boolean> {
    const entry = await this.getRosterEntry(employeeId, date);
    return !entry?.isWeekOff && entry?.workMode === 'WORK_FROM_HOME';
  }

  async getActiveShift(employeeId: string, date: Date): Promise<Shift | null> {
    const entry = await this.getRosterEntry(employeeId, date);
    return entry?.shift ?? null;
  }

  // A day that doesn't count toward leave deduction or attendance-as-worked:
  // holiday or configured week-off (Sections 7.3 & 7.5 Business Rules).
  async isNonWorkingDay(employeeId: string, date: Date): Promise<boolean> {
    const [holiday, weekOff] = await Promise.all([
      this.isHoliday(employeeId, date),
      this.isWeekOff(employeeId, date),
    ]);
    return holiday || weekOff;
  }
}
