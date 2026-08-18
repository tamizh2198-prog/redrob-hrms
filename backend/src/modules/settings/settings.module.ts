import { Module } from '@nestjs/common';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';
import { BackupReminderService } from './backup-reminder.service';

@Module({
  controllers: [SettingsController],
  providers: [SettingsService, BackupReminderService],
})
export class SettingsModule {}
