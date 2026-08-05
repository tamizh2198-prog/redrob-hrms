import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../shared/database/prisma.service';
import { NotificationService } from '../../shared/notifications/notification.service';

const REMINDER_WINDOWS_DAYS = [30, 15, 7];

function startOfDayOffset(days: number): Date {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + days);
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
          data: { docType: doc.docType, daysRemaining: days },
        });
        await this.notifications.send({
          recipientId: 'hr-admin',
          template: 'document.expiring',
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
