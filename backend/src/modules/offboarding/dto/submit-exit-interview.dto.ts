import { IsObject } from 'class-validator';

export class SubmitExitInterviewDto {
  @IsObject()
  responses: Record<string, unknown>;
}
