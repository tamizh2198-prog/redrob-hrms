import { IsNumber, IsOptional, Min } from 'class-validator';
import { Type } from 'class-transformer';

// Section 7.10: F&F "automatically pulls" leave encashment and asset
// recovery from their own modules — no re-entry needed for those. The one
// number this system genuinely has no source for is a per-day pay rate
// (there's no payroll module), so HR supplies it here to convert the
// auto-pulled day counts and shortfall days into currency.
export class ComputeSettlementDto {
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  perDayPayRate: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  pendingSalary?: number;
}
