import { Injectable, Logger } from '@nestjs/common';

export interface NotificationPayload {
  recipientId: string;
  template: string;
  data?: Record<string, unknown>;
}

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  send(payload: NotificationPayload): Promise<void> {
    // TODO: dispatch via the notifications module's channels (email/in-app/etc.)
    // once Section 7.16 is built; every other module calls this same entry point.
    this.logger.log(`notify ${payload.recipientId} via "${payload.template}"`);
    return Promise.resolve();
  }
}
