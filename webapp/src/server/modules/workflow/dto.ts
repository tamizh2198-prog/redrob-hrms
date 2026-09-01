import { Type } from "class-transformer";
import { ArrayMinSize, IsBoolean, IsEnum, IsIn, IsInt, IsNumber, IsObject, IsOptional, IsString, IsUUID, Min, ValidateNested } from "class-validator";
import { Role } from "@prisma/client";

export class StepConditionDto {
  @IsString()
  field: string;

  @IsIn(["gt", "gte", "lt", "lte", "eq"])
  operator: "gt" | "gte" | "lt" | "lte" | "eq";

  @IsNumber()
  value: number;
}

export class ApproverRuleDto {
  @IsIn(["MANAGER", "SKIP_MANAGER", "ROLE"])
  type: "MANAGER" | "SKIP_MANAGER" | "ROLE";

  @IsOptional()
  @IsEnum(Role)
  role?: Role;
}

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

export class CreateWorkflowDefinitionDto {
  @IsString()
  name: string;

  // Free-text source-module tag (e.g. "LEAVE") — not an enum, so new
  // modules can plug into the engine without a schema change.
  @IsString()
  module: string;

  @ValidateNested({ each: true })
  @Type(() => WorkflowStepDto)
  @ArrayMinSize(1)
  steps: WorkflowStepDto[];
}

export class CreateApprovalRequestDto {
  @IsUUID()
  workflowId: string;

  @IsString()
  sourceModule: string;

  @IsString()
  sourceRecordId: string;

  // Numeric/string context evaluated against each step's condition (e.g.
  // { "daysCount": 12 }).
  @IsOptional()
  @IsObject()
  context?: Record<string, unknown>;
}

export class DecideApprovalDto {
  @IsIn(["APPROVED", "REJECTED"])
  decision: "APPROVED" | "REJECTED";

  @IsOptional()
  @IsString()
  comment?: string;
}
