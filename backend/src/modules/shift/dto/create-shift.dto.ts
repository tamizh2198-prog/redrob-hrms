import {
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
} from 'class-validator';

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

export class CreateShiftDto {
  @IsOptional()
  @IsString()
  companyId?: string;

  @IsString()
  name: string;

  @Matches(HHMM, { message: 'startTime must be in HH:mm format' })
  startTime: string;

  @Matches(HHMM, { message: 'endTime must be in HH:mm format' })
  endTime: string;

  @IsOptional()
  @IsNumber()
  graceMinutes?: number;

  @IsOptional()
  @IsNumber()
  halfDayHours?: number;

  @IsOptional()
  @IsBoolean()
  isNightShift?: boolean;
}
