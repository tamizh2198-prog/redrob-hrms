import { CandidateStage } from "@prisma/client";
import { IsBoolean, IsDateString, IsEmail, IsEnum, IsIn, IsInt, IsNumber, IsObject, IsOptional, IsString, IsUUID, Min, MinLength } from "class-validator";

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

export class CreateCandidateDto {
  @IsUUID()
  requisitionId: string;

  @IsString()
  name: string;

  @IsEmail()
  email: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  resumeRef?: string;

  @IsOptional()
  @IsString()
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
