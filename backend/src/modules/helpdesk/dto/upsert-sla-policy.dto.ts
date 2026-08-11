import { IsEnum, IsInt, IsOptional, IsUUID, Min } from 'class-validator';
import { TicketCategory, TicketPriority } from '@prisma/client';

export class UpsertSlaPolicyDto {
  @IsEnum(TicketCategory)
  category: TicketCategory;

  @IsEnum(TicketPriority)
  priority: TicketPriority;

  @IsInt()
  @Min(1)
  slaHours: number;

  @IsOptional()
  @IsUUID()
  agentId?: string;
}
