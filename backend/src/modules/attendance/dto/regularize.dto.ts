import { AttendanceStatus } from '@prisma/client';
import { IsDateString, IsEnum, IsOptional, IsString } from 'class-validator';

export class RegularizeDto {
  @IsDateString()
  date: string;

  @IsEnum(AttendanceStatus)
  requestedStatus: AttendanceStatus;

  @IsString()
  reason: string;

  @IsOptional()
  @IsString()
  evidenceRef?: string;
}
