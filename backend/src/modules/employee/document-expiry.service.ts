import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../shared/database/prisma.service';
import { NotificationService } from '../../shared/notifications/notification.service';

const REMINDER_WINDOWS_DAYS = [30, 15, 7];

// UTC-normalized: document expiryDate values come from date-only input,
// which parses as UTC — a local boundary here would drift the reminder
// window off by a day outside UTC+0 servers (see calendar.service.ts).
function startOfDayOffset(days: number): Date {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() + days);
  return date;
}

@Injectable()
export class DocumentExpiryService {
  private readonly logger = new Logger(DocumentExpiryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async notifyExpiringDocuments(): Promise<void> {
    for (const days of REMINDER_WINDOWS_DAYS) {
      const dayStart = startOfDayOffset(days);
      const dayEnd = startOfDayOffset(days + 1);

      const documents = await this.prisma.employeeDocument.findMany({
        where: { expiryDate: { gte: dayStart, lt: dayEnd } },
        include: { employee: true },
      });

      for (const doc of documents) {
        await this.notifications.send({
          recipientId: doc.employeeId,
          template: 'document.expiring',
          body: `Your ${doc.docType} document is expiring in ${days} day${days === 1 ? '' : 's'}. Please renew and re-upload it.`,
          data: { docType: doc.docType, daysRemaining: days },
        });
        await this.notifications.send({
          recipientId: 'hr-admin',
          template: 'document.expiring',
          body: `${doc.employee.firstName} ${doc.employee.lastName}'s ${doc.docType} document is expiring in ${days} day${days === 1 ? '' : 's'}.`,
          data: {
            employeeId: doc.employeeId,
            docType: doc.docType,
            daysRemaining: days,
          },
        });
      }

      if (documents.length > 0) {
        this.logger.log(
          `${documents.length} document(s) expiring in ${days} days notified`,
        );
      }
    }
  }
}
