import { IsBoolean, IsOptional } from 'class-validator';

export class MarkSettlementPaidDto {
  @IsOptional()
  @IsBoolean()
  rehireEligible?: boolean;
}
