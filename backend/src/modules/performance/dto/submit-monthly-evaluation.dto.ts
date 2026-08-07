import {
  IsDateString,
  IsInt,
  IsString,
  IsUUID,
  Max,
  Min,
  MinLength,
} from 'class-validator';

// Policy Section 4 "Monthly Evaluation Process": always submitted by the
// employee's manager (or HR), never self-service — no employeeId default.
export class SubmitMonthlyEvaluationDto {
  @IsUUID()
  employeeId: string;

  // Any day within the evaluated month; the service normalizes it to the 1st.
  @IsDateString()
  period: string;

  @IsInt()
  @Min(0)
  @Max(1000)
  kpiScore: number;

  // Policy Section 2: "Managers must provide appropriate justification and
  // supporting evidence for all scores."
  @IsString()
  @MinLength(1)
  justification: string;
}
