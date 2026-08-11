import { IsEnum, IsOptional, IsString } from 'class-validator';
import { TicketCategory } from '@prisma/client';

export class SearchFaqQueryDto {
  @IsOptional()
  @IsString()
  q?: string;

  @IsOptional()
  @IsEnum(TicketCategory)
  category?: TicketCategory;
}
