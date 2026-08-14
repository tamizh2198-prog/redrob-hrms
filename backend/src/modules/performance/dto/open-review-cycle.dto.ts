import {
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';
import { ReviewCycleType } from '@prisma/client';

export class OpenReviewCycleDto {
  @IsOptional()
  @IsUUID()
  companyId?: string;

  @IsString()
  name: string;

  // Defaults to QUARTERLY in the service when omitted, so existing callers
  // that never send this keep creating quarterly cycles unchanged.
  @IsOptional()
  @IsEnum(ReviewCycleType)
  cycleType?: ReviewCycleType;

  @IsDateString()
  periodStart: string;

  // Optional: when omitted, the service derives it from periodStart +
  // cycleType (1/3/12 months). Still accepted explicitly for callers that
  // want a custom boundary, exactly as before this field existed.
  @IsOptional()
  @IsDateString()
  periodEnd?: string;
}
