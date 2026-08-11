import { IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { TicketStatus } from '@prisma/client';

export class UpdateStatusDto {
  @IsEnum(TicketStatus)
  status: TicketStatus;

  // Section 7.11 Business Rule: "A ticket cannot be closed without a
  // resolution note" — required by the time status becomes CLOSED, either
  // supplied here or already stored from an earlier RESOLVED transition.
  @IsOptional()
  @IsString()
  resolutionNote?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  csatRating?: number;
}
