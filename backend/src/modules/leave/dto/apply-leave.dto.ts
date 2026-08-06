import { IsDateString, IsOptional, IsString, IsUUID } from 'class-validator';

export class ApplyLeaveDto {
  @IsUUID()
  leaveTypeId: string;

  @IsDateString()
  startDate: string;

  @IsDateString()
  endDate: string;

  @IsOptional()
  @IsString()
  reason?: string;
}
