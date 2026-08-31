import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../../shared/rbac/roles.decorator';
import { RequiresModule } from '../../shared/rbac/requires-module.decorator';
import { CurrentUser } from '../../shared/auth/current-user.decorator';
import { AnnouncementsService } from './announcements.service';
import { CreateAnnouncementDto } from './dto/create-announcement.dto';
import { CreateRecognitionDto } from './dto/create-recognition.dto';

@Controller()
@RequiresModule('ANNOUNCEMENTS')
export class AnnouncementsController {
  constructor(private readonly announcementsService: AnnouncementsService) {}

  @Post('announcements')
  @Roles(Role.MANAGER, Role.HR_ADMIN, Role.HR_ASSOCIATE, Role.SUPER_ADMIN)
  createAnnouncement(
    @Body() dto: CreateAnnouncementDto,
    @CurrentUser() user: { userId: string },
  ) {
    return this.announcementsService.createAnnouncement(dto, user.userId);
  }

  @Get('announcements')
  listAnnouncements(@CurrentUser() user: { userId: string; role: string }) {
    return this.announcementsService.listAnnouncements(
      user.userId,
      user.role as Role,
    );
  }

  @Get('announcements/:id')
  getAnnouncement(
    @Param('id') id: string,
    @CurrentUser() user: { userId: string; role: string },
  ) {
    return this.announcementsService.getAnnouncement(
      id,
      user.userId,
      user.role as Role,
    );
  }

  @Post('announcements/:id/ack')
  ackAnnouncement(
    @Param('id') id: string,
    @CurrentUser() user: { userId: string },
  ) {
    return this.announcementsService.ackAnnouncement(id, user.userId);
  }

  @Get('announcements/:id/compliance')
  @Roles(Role.HR_ADMIN, Role.HR_ASSOCIATE, Role.SUPER_ADMIN)
  getCompliance(@Param('id') id: string) {
    return this.announcementsService.getCompliance(id);
  }

  @Get('announcements/:id/compliance/users')
  @Roles(Role.HR_ADMIN, Role.HR_ASSOCIATE, Role.SUPER_ADMIN)
  getComplianceUsers(@Param('id') id: string) {
    return this.announcementsService.getComplianceUsers(id);
  }

  @Post('recognition')
  createRecognition(
    @Body() dto: CreateRecognitionDto,
    @CurrentUser() user: { userId: string },
  ) {
    return this.announcementsService.createRecognition(dto, user.userId);
  }

  @Get('recognition/feed')
  listRecognitionFeed(@CurrentUser() user: { userId: string; role: string }) {
    return this.announcementsService.listRecognitionFeed(
      user.userId,
      user.role as Role,
    );
  }
}
