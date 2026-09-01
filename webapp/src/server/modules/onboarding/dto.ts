import { Type } from "class-transformer";
import {
  ArrayMinSize,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from "class-validator";
import { ChecklistOwnerRole, OnboardingPhase } from "@prisma/client";

export class ChecklistTaskTemplateDto {
  @IsEnum(ChecklistOwnerRole)
  ownerRole: ChecklistOwnerRole;

  @IsEnum(OnboardingPhase)
  phase: OnboardingPhase;

  @IsString()
  description: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  dueOffsetDays?: number;
}

export class CreateTemplateDto {
  @IsOptional()
  @IsUUID()
  companyId?: string;

  @IsString()
  name: string;

  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @ValidateNested({ each: true })
  @Type(() => ChecklistTaskTemplateDto)
  @ArrayMinSize(1)
  tasks: ChecklistTaskTemplateDto[];
}

export class InitChecklistDto {
  @IsOptional()
  @IsUUID()
  templateId?: string;
}

export class PortalCompleteTaskDto {
  @IsString()
  token: string;
}

export class PreboardSubmitDto {
  @IsString()
  token: string;

  @IsString()
  fieldType: string;

  @IsString()
  valueRef: string;
}

export class SubmitProbationFeedbackDto {
  @IsInt()
  @Min(1)
  @Max(5)
  companyRating: number;

  @IsInt()
  @Min(1)
  @Max(5)
  workCultureRating: number;

  @IsOptional()
  @IsString()
  comments?: string;
}
