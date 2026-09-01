import { IsOptional, IsString, IsUUID } from "class-validator";

export class SendMessageDto {
  @IsOptional()
  @IsUUID()
  conversationId?: string;

  @IsString()
  message: string;
}

export class ConfirmActionDto {
  // The AssistantMessage id that carries the pending proposedAction.
  @IsUUID()
  messageId: string;
}

export class UploadPolicyDocumentDto {
  @IsString()
  title: string;

  @IsString()
  content: string;
}
