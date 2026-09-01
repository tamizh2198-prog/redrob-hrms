import { Type } from "class-transformer";
import { IsBoolean, IsEnum, IsInt, IsOptional, IsString, IsUUID, Max, Min } from "class-validator";
import { TicketCategory, TicketPriority, TicketStatus } from "@prisma/client";

export class CreateTicketDto {
  @IsEnum(TicketCategory)
  category: TicketCategory;

  @IsOptional()
  @IsEnum(TicketPriority)
  priority?: TicketPriority;

  @IsString()
  subject: string;

  @IsString()
  description: string;
}

export class AddMessageDto {
  @IsString()
  body: string;

  // Only honored when the actor is the assigned agent or HR Admin/Super
  // Admin — enforced in service.ts, not trusted from the client.
  @IsOptional()
  @IsBoolean()
  isInternalNote?: boolean;

  @IsOptional()
  @IsString()
  attachmentRef?: string;
}

export class AssignTicketDto {
  @IsUUID()
  agentId: string;
}

export class UpdateStatusDto {
  @IsEnum(TicketStatus)
  status: TicketStatus;

  // Business Rule: "A ticket cannot be closed without a resolution note"
  // — required by the time status becomes CLOSED, either supplied here or
  // already stored from an earlier RESOLVED transition.
  @IsOptional()
  @IsString()
  resolutionNote?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  csatRating?: number;
}

export class ListTicketsQueryDto {
  @IsOptional()
  @IsEnum(TicketStatus)
  status?: TicketStatus;

  @IsOptional()
  @IsEnum(TicketCategory)
  category?: TicketCategory;

  @IsOptional()
  @IsEnum(TicketPriority)
  priority?: TicketPriority;

  @IsOptional()
  @IsUUID()
  assignedAgentId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pageSize?: number;
}

export class CreateFaqDto {
  @IsOptional()
  @IsEnum(TicketCategory)
  category?: TicketCategory;

  @IsString()
  question: string;

  @IsString()
  answer: string;
}

export class SearchFaqQueryDto {
  @IsOptional()
  @IsString()
  q?: string;

  @IsOptional()
  @IsEnum(TicketCategory)
  category?: TicketCategory;
}

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
