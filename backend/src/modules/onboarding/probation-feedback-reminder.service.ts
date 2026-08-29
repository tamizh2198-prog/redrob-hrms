import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { EmployeeStatus } from '@prisma/client';
import { PrismaService } from '../../shared/database/prisma.service';
import { NotificationService } from '../../shared/notifications/notification.service';
import { PROBATION_CHECKPOINT_DAYS } from './onboarding.service';

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

@Injectable()
export class ProbationFeedbackReminderService {
  private readonly logger = new Logger(ProbationFeedbackReminderService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
  ) {}

  // Each checkpoint (day 30/60/90) fires independently and exactly once —
  // reminderSentAt is the per-occurrence guard, same shape as Ticket's
  // slaWarningNotifiedAt/slaBreachedAt in HelpdeskService.runSlaSweep(),
  // rather than a sliding-window check (that only works for a single,
  // one-time nudge, not a repeating series).
  @Cron(CronExpression.EVERY_HOUR)
  async sendDueReminders(): Promise<void> {
    const due = await this.prisma.probationFeedback.findMany({
      where: { reminderSentAt: null },
      include: { employee: true },
    });

    const now = new Date();
    let sent = 0;
    for (const feedback of due) {
      const { employee } = feedback;
      if (!employee.dateOfJoining) continue;
      // They're gone — nothing left to ask.
      if (employee.status === EmployeeStatus.TERMINATED) continue;

      const dueDate = addDays(
        employee.dateOfJoining,
        PROBATION_CHECKPOINT_DAYS[feedback.checkpoint],
      );
      if (now < dueDate) continue;

      await this.prisma.probationFeedback.update({
        where: { id: feedback.id },
        data: { reminderSentAt: now },
      });
      await this.notifications.send({
        recipientId: employee.id,
        template: 'onboarding.probation-feedback-due',
        body: "You're a little further into your journey with us — share quick feedback on the company and work culture so far.",
        data: { feedbackId: feedback.id, checkpoint: feedback.checkpoint },
      });
      sent++;
    }

    if (sent > 0) {
      this.logger.log(`Sent ${sent} probation-feedback reminder(s)`);
    }
  }
}
