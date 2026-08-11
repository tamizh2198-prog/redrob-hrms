import { IsUUID } from 'class-validator';

export class ConfirmActionDto {
  // The AssistantMessage id that carries the pending proposedAction.
  @IsUUID()
  messageId: string;
}
