import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class AddMessageDto {
  @IsString()
  body: string;

  // Only honored when the actor is the assigned agent or HR Admin/Super
  // Admin — enforced in helpdesk.service.ts, not trusted from the client.
  @IsOptional()
  @IsBoolean()
  isInternalNote?: boolean;

  @IsOptional()
  @IsString()
  attachmentRef?: string;
}
