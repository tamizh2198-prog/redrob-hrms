import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class LearningDecisionDto {
  @IsBoolean()
  approve: boolean;

  @IsOptional()
  @IsString()
  comment?: string;
}
