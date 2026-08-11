import { Module } from '@nestjs/common';
import { AnnouncementsController } from './announcements.controller';
import { AnnouncementsService } from './announcements.service';
import { AnnouncementsRemindersService } from './announcements-reminders.service';

@Module({
  controllers: [AnnouncementsController],
  providers: [AnnouncementsService, AnnouncementsRemindersService],
})
export class AnnouncementsModule {}
