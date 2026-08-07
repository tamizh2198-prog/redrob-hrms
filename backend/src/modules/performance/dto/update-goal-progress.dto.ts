import { IsNumber } from 'class-validator';

export class UpdateGoalProgressDto {
  @IsNumber()
  actual: number;
}
