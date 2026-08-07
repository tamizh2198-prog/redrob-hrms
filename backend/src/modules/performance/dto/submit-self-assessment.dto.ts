import { IsObject, IsUUID } from 'class-validator';

export class SubmitSelfAssessmentDto {
  @IsUUID()
  cycleId: string;

  @IsObject()
  assessment: Record<string, unknown>;
}
