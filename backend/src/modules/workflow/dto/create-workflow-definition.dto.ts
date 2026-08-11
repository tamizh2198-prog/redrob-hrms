import { Type } from 'class-transformer';
import { ArrayMinSize, IsString, ValidateNested } from 'class-validator';
import { WorkflowStepDto } from './workflow-step.dto';

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
