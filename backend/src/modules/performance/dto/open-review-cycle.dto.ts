import { IsDateString, IsOptional, IsString, IsUUID } from 'class-validator';

export class OpenReviewCycleDto {
  @IsOptional()
  @IsUUID()
  companyId?: string;

  @IsString()
  name: string;

  @IsDateString()
  periodStart: string;

  @IsDateString()
  periodEnd: string;
}
