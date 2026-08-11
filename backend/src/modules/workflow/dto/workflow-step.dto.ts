import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsBoolean,
  IsInt,
  IsOptional,
  Min,
  ValidateNested,
} from 'class-validator';
import { IsEnum } from 'class-validator';
import { Role } from '@prisma/client';
import { ApproverRuleDto } from './approver-rule.dto';
import { StepConditionDto } from './step-condition.dto';

export class WorkflowStepDto {
  @IsInt()
  @Min(0)
  sequence: number;

  @ValidateNested({ each: true })
  @Type(() => ApproverRuleDto)
  @ArrayMinSize(1)
  approverRules: ApproverRuleDto[];

  @IsBoolean()
  requireAll: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  slaHours?: number;

  @IsOptional()
  @IsEnum(Role)
  escalationTargetRole?: Role;

  @IsOptional()
  @ValidateNested()
  @Type(() => StepConditionDto)
  condition?: StepConditionDto;
}
