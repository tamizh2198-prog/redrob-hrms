import { Global, Module } from '@nestjs/common';
import { NotificationService } from './notification.service';
import { NotificationsModule } from '../../modules/notifications/notifications.module';

@Global()
@Module({
  imports: [NotificationsModule],
  providers: [NotificationService],
  exports: [NotificationService],
})
export class NotificationModule {}
