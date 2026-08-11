import { Injectable, Logger } from '@nestjs/common';
import { NotificationsService } from '../../modules/notifications/notifications.service';

export interface NotificationPayload {
  recipientId: string;
  template: string;
  data?: Record<string, unknown>;
}

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(private readonly notificationsService: NotificationsService) {}

  async send(payload: NotificationPayload): Promise<void> {
    this.logger.log(`notify ${payload.recipientId} via "${payload.template}"`);
    // Section 7.16: the notifications feature module owns real persistence/
    // dispatch now — this stays the stable entry point every other module
    // already calls.
    await this.notificationsService.dispatch(payload);
  }
}
