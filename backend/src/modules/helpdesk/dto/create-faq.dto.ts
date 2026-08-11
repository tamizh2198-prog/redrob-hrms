import { IsEnum, IsOptional, IsString } from 'class-validator';
import { TicketCategory } from '@prisma/client';

export class CreateFaqDto {
  @IsOptional()
  @IsEnum(TicketCategory)
  category?: TicketCategory;

  @IsString()
  question: string;

  @IsString()
  answer: string;
}
