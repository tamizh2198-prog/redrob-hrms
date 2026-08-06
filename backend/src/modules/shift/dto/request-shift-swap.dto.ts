import { IsBoolean, IsDateString, IsOptional, IsUUID } from 'class-validator';

export class RequestShiftSwapDto {
  @IsUUID()
  counterpartId: string;

  @IsDateString()
  date: string;

  // HR Admin/Super Admin only: bypass the same-department eligibility rule.
  @IsOptional()
  @IsBoolean()
  override?: boolean;
}
