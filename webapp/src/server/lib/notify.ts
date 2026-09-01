import type { PrismaClient } from "@prisma/client";
import { dispatch, type NotificationPayload } from "../modules/notifications/service";

export type { NotificationPayload };

// Stable entry point every other module calls — mirrors
// shared/notifications/notification.service.ts's NotificationService.send(),
// which just logs and delegates to the notifications module's real
// persistence/dispatch logic.
export async function notify(prisma: PrismaClient, payload: NotificationPayload): Promise<void> {
  console.log(`notify ${payload.recipientId} via "${payload.template}"`);
  await dispatch(prisma, payload);
}
