import { IsDateString, IsString } from 'class-validator';

export class AdjustLwdDto {
  @IsDateString()
  newDate: string;

  @IsString()
  reason: string;
}
