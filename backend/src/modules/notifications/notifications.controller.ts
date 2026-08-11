import { Body, Controller, Get, Param, Patch, Query } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../../shared/rbac/roles.decorator';
import { CurrentUser } from '../../shared/auth/current-user.decorator';
import { NotificationsService } from './notifications.service';
import { UpdatePreferencesDto } from './dto/update-preferences.dto';
import { ListInboxQueryDto } from './dto/list-inbox-query.dto';

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get('inbox')
  listInbox(
    @Query() query: ListInboxQueryDto,
    @CurrentUser() user: { userId: string },
  ) {
    return this.notificationsService.listInbox(user.userId, query);
  }

  @Patch(':id/read')
  markRead(@Param('id') id: string, @CurrentUser() user: { userId: string }) {
    return this.notificationsService.markRead(id, user.userId);
  }

  @Patch('read-all')
  markAllRead(@CurrentUser() user: { userId: string }) {
    return this.notificationsService.markAllRead(user.userId);
  }

  @Get('preferences')
  getPreferences(@CurrentUser() user: { userId: string }) {
    return this.notificationsService.getPreferences(user.userId);
  }

  @Patch('preferences')
  updatePreferences(
    @Body() dto: UpdatePreferencesDto,
    @CurrentUser() user: { userId: string },
  ) {
    return this.notificationsService.updatePreferences(user.userId, dto);
  }

  @Get('logs')
  @Roles(Role.HR_ADMIN, Role.SUPER_ADMIN)
  getDeliveryReport() {
    return this.notificationsService.getDeliveryReport();
  }
}
