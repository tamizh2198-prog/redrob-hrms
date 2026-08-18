import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Role } from '@prisma/client';
import { PrismaService } from '../../shared/database/prisma.service';
import { NotificationService } from '../../shared/notifications/notification.service';

// Pilot-launch basic backup (SettingsController's GET /settings/backup) is
// on-demand only — nothing runs it automatically, since there's nowhere
// durable to store the result without added cloud storage. This is the
// other half of "basic backup": a standing weekly nudge so downloading a
// fresh one doesn't get forgotten.
@Injectable()
export class BackupReminderService {
  private readonly logger = new Logger(BackupReminderService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
  ) {}

  @Cron(CronExpression.EVERY_WEEK)
  async remindSuperAdmins(): Promise<void> {
    const superAdmins = await this.prisma.employee.findMany({
      where: { role: Role.SUPER_ADMIN },
      select: { id: true },
    });
    for (const admin of superAdmins) {
      await this.notifications.send({
        recipientId: admin.id,
        template: 'settings.backup-reminder',
        body: 'Weekly reminder: download a fresh database backup from Settings to keep your disaster-recovery copy current.',
      });
    }
    if (superAdmins.length > 0) {
      this.logger.log(`Sent ${superAdmins.length} weekly backup reminder(s)`);
    }
  }
}
