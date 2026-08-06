import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';
import { ChecklistOwnerRole } from '@prisma/client';

export class ChecklistTaskTemplateDto {
  @IsEnum(ChecklistOwnerRole)
  ownerRole: ChecklistOwnerRole;

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

  @ValidateNested({ each: true })
  @Type(() => ChecklistTaskTemplateDto)
  @ArrayMinSize(1)
  tasks: ChecklistTaskTemplateDto[];
}
