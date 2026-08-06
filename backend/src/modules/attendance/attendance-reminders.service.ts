import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../shared/database/prisma.service';
import { NotificationService } from '../../shared/notifications/notification.service';
import { AttendanceService } from './attendance.service';

// Normalizes to UTC midnight to match the same convention used everywhere
// else these date keys are written/read — see calendar.service.ts.
function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

@Injectable()
export class AttendanceRemindersService {
  private readonly logger = new Logger(AttendanceRemindersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
    private readonly attendance: AttendanceService,
  ) {}

  // "Missed punch-out detected end-of-day → employee reminder" (Section 7.2).
  @Cron(CronExpression.EVERY_DAY_AT_11PM)
  async notifyMissedPunchOuts(): Promise<void> {
    const today = startOfDay(new Date());
    const missed = await this.prisma.attendanceRecord.findMany({
      where: { date: today, checkInTime: { not: null }, checkOutTime: null },
    });
    for (const record of missed) {
      await this.notifications.send({
        recipientId: record.employeeId,
        template: 'attendance.missed-punch-out',
      });
    }
    if (missed.length > 0) {
      this.logger.log(`Sent ${missed.length} missed punch-out reminder(s)`);
    }
  }

  // "Regularization pending > SLA → escalation to HR Admin" (Section 7.2).
  @Cron(CronExpression.EVERY_HOUR)
  async escalateOverdueRegularizations(): Promise<void> {
    const overdue = await this.attendance.listPendingEscalations();
    for (const request of overdue) {
      await this.notifications.send({
        recipientId: 'hr-admin',
        template: 'regularization.escalated',
        data: { requestId: request.id, employeeId: request.employeeId },
      });
    }
    if (overdue.length > 0) {
      this.logger.log(
        `Escalated ${overdue.length} overdue regularization request(s)`,
      );
    }
  }
}
