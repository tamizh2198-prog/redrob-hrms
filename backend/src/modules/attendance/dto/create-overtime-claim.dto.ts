import { IsDateString, IsNumber, IsString, Max, Min } from 'class-validator';

export class CreateOvertimeClaimDto {
  @IsDateString()
  date: string;

  @IsNumber()
  @Min(0.5)
  @Max(16)
  hoursClaimed: number;

  @IsString()
  reason: string;
}
