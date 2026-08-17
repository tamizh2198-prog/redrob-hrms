import { AttendanceStatus } from '@prisma/client';
import { IsDateString, IsEnum, IsOptional, IsString, Matches } from 'class-validator';

const TIME_HH_MM = /^([01]\d|2[0-3]):([0-5]\d)$/;

export class RegularizeDto {
  @IsDateString()
  date: string;

  @IsEnum(AttendanceStatus)
  requestedStatus: AttendanceStatus;

  @IsOptional()
  @Matches(TIME_HH_MM, { message: 'checkInTime must be in HH:mm format' })
  checkInTime?: string;

  @IsOptional()
  @Matches(TIME_HH_MM, { message: 'checkOutTime must be in HH:mm format' })
  checkOutTime?: string;

  @IsString()
  reason: string;

  @IsOptional()
  @IsString()
  evidenceRef?: string;
}
