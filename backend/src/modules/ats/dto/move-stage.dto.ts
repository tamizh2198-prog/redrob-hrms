import { IsEnum } from 'class-validator';
import { CandidateStage } from '@prisma/client';

export class MoveStageDto {
  @IsEnum(CandidateStage)
  stage: CandidateStage;
}
