import { IsBoolean, IsDateString, IsEnum, IsInt, IsNumber, IsObject, IsOptional, IsString, IsUUID, Max, Min, MinLength } from "class-validator";
import { ReviewCycleType } from "@prisma/client";

export class CreateGoalDto {
  // Defaults to the actor's own id when omitted — self-service goal setting
  // is the common case.
  @IsOptional()
  @IsUUID()
  employeeId?: string;

  @IsUUID()
  cycleId: string;

  @IsOptional()
  @IsUUID()
  parentGoalId?: string;

  @IsString()
  title: string;

  @IsOptional()
  @IsNumber()
  target?: number;

  @IsNumber()
  @Min(0)
  weightage: number;
}

export class UpdateGoalProgressDto {
  @IsNumber()
  actual: number;
}

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
  // want a custom boundary.
  @IsOptional()
  @IsDateString()
  periodEnd?: string;
}

export class SubmitSelfAssessmentDto {
  @IsUUID()
  cycleId: string;

  @IsObject()
  assessment: Record<string, unknown>;
}

export class SubmitManagerAssessmentDto {
  @IsUUID()
  cycleId: string;

  @IsUUID()
  employeeId: string;

  @IsObject()
  assessment: Record<string, unknown>;

  @IsNumber()
  rating: number;
}

// Policy: always submitted by the employee's manager (or HR), never
// self-service — no employeeId default.
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

  @IsString()
  @MinLength(1)
  justification: string;
}

export class AuditMonthlyEvaluationDto {
  @IsBoolean()
  approve: boolean;

  // Required by the service when approve is false — the manager needs a
  // reason to act on when resubmitting.
  @IsOptional()
  @IsString()
  auditNotes?: string;
}
