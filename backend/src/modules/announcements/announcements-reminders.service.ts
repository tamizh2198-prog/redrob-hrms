import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { NotificationService } from '../../shared/notifications/notification.service';
import { AnnouncementsService } from './announcements.service';

// Section 7.12 Business Rule: "Mandatory unread reminder → T+2 days" —
// orchestration only; the "who's still unacknowledged past the window"
// query and idempotent remindedAt-marking live on
// AnnouncementsService.findDueReminders() (same split as
// AttendanceRemindersService / HelpdeskEscalationService).
@Injectable()
export class AnnouncementsRemindersService {
  private readonly logger = new Logger(AnnouncementsRemindersService.name);

  constructor(
    private readonly notifications: NotificationService,
    private readonly announcementsService: AnnouncementsService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_9AM)
  async sendUnreadReminders(): Promise<void> {
    const reminded = await this.announcementsService.findDueReminders();

    for (const ack of reminded) {
      await this.notifications.send({
        recipientId: ack.employeeId,
        template: 'announcements.reminder',
        body: `Reminder: you haven't acknowledged the announcement "${ack.announcement.title}" yet.`,
        data: { announcementId: ack.announcementId },
      });
    }

    if (reminded.length > 0) {
      this.logger.log(
        `Sent ${reminded.length} unread announcement reminder(s)`,
      );
    }
  }
}
