import { CandidateStage } from "@prisma/client";
import { IsBoolean, IsDateString, IsEmail, IsEnum, IsIn, IsInt, IsNumber, IsObject, IsOptional, IsString, IsUUID, MaxLength, Min, MinLength } from "class-validator";

export class CreateRequisitionDto {
  @IsOptional()
  @IsUUID()
  companyId?: string;

  @IsString()
  title: string;

  @IsUUID()
  departmentId: string;

  @IsUUID()
  hiringManagerId: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  headcount?: number;

  @IsOptional()
  @IsNumber()
  budgetCtc?: number;
}

// Public, unauthenticated endpoint (anyone can apply) — every string field
// needs a length bound so it can't be used to stuff arbitrarily large
// payloads into the database.
export class CreateCandidateDto {
  @IsUUID()
  requisitionId: string;

  @IsString()
  @MaxLength(200)
  name: string;

  @IsEmail()
  @MaxLength(200)
  email: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  resumeRef?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  source?: string;
}

export class MoveStageDto {
  @IsEnum(CandidateStage)
  stage: CandidateStage;
}

export class ScheduleInterviewDto {
  @IsUUID()
  interviewerId: string;

  @IsDateString()
  scheduledAt: string;
}

export class SubmitScorecardDto {
  @IsObject()
  scorecard: Record<string, unknown>;

  @IsOptional()
  @IsString()
  recommendation?: string;
}

export class CreateOfferDto {
  @IsUUID()
  candidateId: string;

  @IsObject()
  ctcBreakup: Record<string, unknown>;
}

export class RespondOfferDto {
  @IsString()
  token: string;

  @IsIn(["ACCEPT", "DECLINE"])
  decision: "ACCEPT" | "DECLINE";
}

export class CreateOfferTemplateDto {
  @IsString()
  @MinLength(1)
  name: string;

  @IsString()
  @MinLength(1)
  subject: string;

  @IsString()
  @MinLength(1)
  body: string;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}

export class UpdateOfferTemplateDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  subject?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  body?: string;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}

export class SendOfferDto {
  // Which letter template to render for this send — omit to use the
  // company's default template (or the built-in fallback copy if none is
  // marked default).
  @IsOptional()
  @IsUUID()
  templateId?: string;
}
