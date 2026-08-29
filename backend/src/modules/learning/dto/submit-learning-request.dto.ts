import { IsNumber, IsString, Min } from 'class-validator';

export class SubmitLearningRequestDto {
  @IsString()
  courseName: string;

  @IsString()
  duration: string;

  @IsString()
  purpose: string;

  @IsString()
  organizationalImpact: string;

  @IsNumber()
  @Min(0)
  cost: number;

  @IsString()
  timeCommitment: string;
}
