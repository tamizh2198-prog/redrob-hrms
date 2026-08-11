import { IsObject, IsOptional, IsString, IsUUID } from 'class-validator';

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
