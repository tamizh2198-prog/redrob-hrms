import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';
import { ChecklistOwnerRole, OnboardingPhase } from '@prisma/client';

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

  // Company-wide (departmentId omitted) only — see
  // OnboardingChecklistTemplate.isDefault's schema comment. Defaults to
  // false; setting it true unseats whichever template previously held it.
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @ValidateNested({ each: true })
  @Type(() => ChecklistTaskTemplateDto)
  @ArrayMinSize(1)
  tasks: ChecklistTaskTemplateDto[];
}
