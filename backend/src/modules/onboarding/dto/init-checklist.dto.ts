import { IsOptional, IsUUID } from 'class-validator';

export class InitChecklistDto {
  @IsOptional()
  @IsUUID()
  templateId?: string;
}
