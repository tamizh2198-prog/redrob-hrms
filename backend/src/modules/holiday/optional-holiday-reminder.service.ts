import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../shared/database/prisma.service';
import { NotificationService } from '../../shared/notifications/notification.service';

// Matches the selection-lock cutoff in HolidayService — the reminder fires
// 3 days before that same cutoff (Section 7.5 Notifications & Triggers).
const REMINDER_DAYS_BEFORE_CUTOFF = 3;
const SELECTION_CUTOFF_DAYS = 7;

// UTC-normalized to match how holiday dates are stored (see calendar.service.ts).
function startOfDayOffset(days: number): Date {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() + days);
  return date;
}

@Injectable()
export class OptionalHolidayReminderService {
  private readonly logger = new Logger(OptionalHolidayReminderService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async notifySelectionWindowClosing(): Promise<void> {
    const daysUntilHoliday =
      SELECTION_CUTOFF_DAYS - REMINDER_DAYS_BEFORE_CUTOFF;
    const dayStart = startOfDayOffset(daysUntilHoliday);
    const dayEnd = startOfDayOffset(daysUntilHoliday + 1);

    const optionalHolidays = await this.prisma.holiday.findMany({
      where: { isOptional: true, date: { gte: dayStart, lt: dayEnd } },
    });

    for (const holiday of optionalHolidays) {
      const employees = await this.prisma.employee.findMany({
        where: { locationId: holiday.locationId },
        select: { id: true },
      });
      const selected = await this.prisma.optionalHolidaySelection.findMany({
        where: { holidayId: holiday.id },
        select: { employeeId: true },
      });
      const selectedIds = new Set(selected.map((s) => s.employeeId));

      for (const employee of employees) {
        if (selectedIds.has(employee.id)) continue;
        await this.notifications.send({
          recipientId: employee.id,
          template: 'holiday.optional-selection-closing',
          data: { holidayId: holiday.id, holidayName: holiday.name },
        });
      }
      this.logger.log(
        `Optional holiday "${holiday.name}" selection reminder sent to ${
          employees.length - selectedIds.size
        } employee(s)`,
      );
    }
  }
}
