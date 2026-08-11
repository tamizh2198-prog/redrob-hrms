import { IsEnum, IsOptional, IsString, IsUUID } from 'class-validator';
import { RecognitionCategory } from '@prisma/client';

export class CreateRecognitionDto {
  @IsUUID()
  recipientId: string;

  @IsString()
  message: string;

  @IsEnum(RecognitionCategory)
  category: RecognitionCategory;

  // Section 7.12 Key Feature: "Recognition can optionally be restricted to
  // a department" — omit for public kudos visible to everyone.
  @IsOptional()
  @IsUUID()
  departmentId?: string;
}
