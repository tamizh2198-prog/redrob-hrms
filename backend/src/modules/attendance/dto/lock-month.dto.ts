import { IsInt, Max, Min } from 'class-validator';

export class LockMonthDto {
  @IsInt()
  year: number;

  @IsInt()
  @Min(1)
  @Max(12)
  month: number;
}
