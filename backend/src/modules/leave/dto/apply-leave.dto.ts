import {
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';

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

  // Phase 6E: half-day duration, NOT a separate leave type — reuses the
  // existing Float daysCount field (0.5 instead of a whole-day count).
  // Only valid when startDate === endDate.
  @IsOptional()
  @IsIn(['FULL_DAY', 'HALF_DAY'])
  duration?: 'FULL_DAY' | 'HALF_DAY';
}
