import {
  IsInt,
  IsNumber,
  IsString,
  IsUUID,
  Max,
  Min,
  MinLength,
} from 'class-validator';

// Always submitted by the employee's manager, never self-service — mirrors
// SubmitMonthlyEvaluationDto's no-default employeeId.
export class SubmitQuarterlyKpiDto {
  @IsUUID()
  employeeId: string;

  @IsInt()
  @Min(2000)
  year: number;

  @IsInt()
  @Min(1)
  @Max(4)
  quarter: number;

  @IsNumber()
  @Min(0)
  @Max(100)
  kpiPercent: number;

  @IsString()
  @MinLength(1)
  justification: string;
}
