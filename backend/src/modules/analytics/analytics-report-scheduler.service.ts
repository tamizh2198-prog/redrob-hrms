import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { NotificationService } from '../../shared/notifications/notification.service';
import { AnalyticsService } from './analytics.service';

// Section 7.13 Phase 5: orchestration only — the "which SavedReports are
// due, and which of their recipients still hold analytics access right
// now" logic lives on AnalyticsService.findDueScheduledReports() (same
// split as AnnouncementsRemindersService / HelpdeskEscalationService).
@Injectable()
export class AnalyticsReportSchedulerService {
  private readonly logger = new Logger(AnalyticsReportSchedulerService.name);

  constructor(
    private readonly notifications: NotificationService,
    private readonly analyticsService: AnalyticsService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async sendDueScheduledReports(): Promise<void> {
    const due = await this.analyticsService.findDueScheduledReports();

    let sent = 0;
    for (const report of due) {
      for (const recipientId of report.validRecipientIds) {
        await this.notifications.send({
          recipientId,
          template: 'analytics.saved-report-ready',
          data: {
            savedReportId: report.savedReportId,
            name: report.name,
            total: report.total,
          },
        });
        sent++;
      }

      const skipped = report.recipientCount - report.validRecipientIds.length;
      if (skipped > 0) {
        this.logger.warn(
          `SavedReport ${report.savedReportId} (${report.name}): ${skipped} recipient(s) no longer hold analytics access and were skipped`,
        );
      }
    }

    if (sent > 0) {
      this.logger.log(
        `Sent ${sent} scheduled analytics report notification(s)`,
      );
    }
  }
}
