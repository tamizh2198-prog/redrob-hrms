import { IsNumber, IsObject, IsUUID } from 'class-validator';

export class SubmitManagerAssessmentDto {
  @IsUUID()
  cycleId: string;

  @IsUUID()
  employeeId: string;

  @IsObject()
  assessment: Record<string, unknown>;

  @IsNumber()
  rating: number;
}
