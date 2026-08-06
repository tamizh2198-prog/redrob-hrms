import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class LeaveDecisionDto {
  @IsBoolean()
  approve: boolean;

  @IsOptional()
  @IsString()
  comment?: string;
}
