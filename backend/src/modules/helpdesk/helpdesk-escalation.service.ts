import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { NotificationService } from '../../shared/notifications/notification.service';
import { HelpdeskService } from './helpdesk.service';

// Section 7.11 Business Rule: "SLA breach automatically escalates to the
// category's designated HR Admin/lead" — orchestration only; the actual
// "who's overdue" query and idempotent timestamp-marking live on
// HelpdeskService.runSlaSweep() (same split as AttendanceRemindersService /
// AttendanceService.listPendingEscalations()).
@Injectable()
export class HelpdeskEscalationService {
  private readonly logger = new Logger(HelpdeskEscalationService.name);

  constructor(
    private readonly notifications: NotificationService,
    private readonly helpdeskService: HelpdeskService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async checkSlaTimers(): Promise<void> {
    const { warnings, breaches } = await this.helpdeskService.runSlaSweep();

    for (const { ticket, escalationContactId } of warnings) {
      const recipients = new Set([
        ticket.assignedAgentId ?? 'hr-admin',
        escalationContactId,
      ]);
      for (const recipientId of recipients) {
        await this.notifications.send({
          recipientId,
          template: 'helpdesk.sla-warning',
          data: { ticketId: ticket.id },
        });
      }
    }

    for (const { ticket, escalationContactId } of breaches) {
      const recipients = new Set([
        ticket.assignedAgentId ?? 'hr-admin',
        escalationContactId,
      ]);
      for (const recipientId of recipients) {
        await this.notifications.send({
          recipientId,
          template: 'helpdesk.sla-breached',
          data: { ticketId: ticket.id },
        });
      }
    }

    if (warnings.length > 0 || breaches.length > 0) {
      this.logger.log(
        `SLA sweep: ${warnings.length} warning(s), ${breaches.length} breach(es)`,
      );
    }
  }
}
