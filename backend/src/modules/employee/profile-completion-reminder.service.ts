import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Role } from '@prisma/client';
import { PrismaService } from '../../shared/database/prisma.service';
import { NotificationService } from '../../shared/notifications/notification.service';
import { computeProfileCompletion } from './profile-completion.util';

const REMINDER_DELAY_HOURS = 24;

@Injectable()
export class ProfileCompletionReminderService {
  private readonly logger = new Logger(ProfileCompletionReminderService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
  ) {}

  // Employees added to the HRMS who still haven't finished their profile
  // 24 hours later get nudged, and so does HR Admin so someone can follow
  // up. Runs hourly and only looks at the 1-hour-wide window that just
  // crossed the 24h mark, so each employee is caught exactly once instead
  // of being re-notified every run.
  @Cron(CronExpression.EVERY_HOUR)
  async remindIncompleteProfiles(): Promise<void> {
    const now = new Date();
    const windowEnd = new Date(
      now.getTime() - REMINDER_DELAY_HOURS * 60 * 60 * 1000,
    );
    const windowStart = new Date(windowEnd.getTime() - 60 * 60 * 1000);

    const candidates = await this.prisma.employee.findMany({
      where: { createdAt: { gte: windowStart, lt: windowEnd } },
    });

    let remindersSent = 0;
    for (const employee of candidates) {
      if (computeProfileCompletion(employee).isComplete) continue;

      await this.notifications.send({
        recipientId: employee.id,
        template: 'profile-completion.reminder',
      });

      const hrAdmins = await this.prisma.employee.findMany({
        where: { companyId: employee.companyId, role: Role.HR_ADMIN },
        select: { id: true },
      });
      for (const admin of hrAdmins) {
        await this.notifications.send({
          recipientId: admin.id,
          template: 'profile-completion.reminder',
          data: { employeeId: employee.id },
        });
      }
      remindersSent++;
    }

    if (remindersSent > 0) {
      this.logger.log(
        `Sent ${remindersSent} profile-completion reminder(s) (24h past joining)`,
      );
    }
  }
}
