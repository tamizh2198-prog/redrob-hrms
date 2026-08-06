import { IsObject, IsOptional, IsString } from 'class-validator';

export class SubmitScorecardDto {
  @IsObject()
  scorecard: Record<string, unknown>;

  @IsOptional()
  @IsString()
  recommendation?: string;
}
