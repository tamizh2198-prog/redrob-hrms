import { LeaveAccrualFrequency } from '@prisma/client';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
} from 'class-validator';

export class CreateLeaveTypeDto {
  @IsOptional()
  @IsString()
  companyId?: string;

  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  code?: string;

  @IsOptional()
  @IsEnum(LeaveAccrualFrequency)
  accrualFrequency?: LeaveAccrualFrequency;

  @IsOptional()
  @IsNumber()
  accrualRate?: number;

  @IsOptional()
  @IsNumber()
  maxCarryForward?: number;

  @IsOptional()
  @IsBoolean()
  isEncashable?: boolean;

  @IsOptional()
  @IsInt()
  requiresDocumentAfterDays?: number;

  @IsOptional()
  @IsBoolean()
  allowsNegativeBalance?: boolean;
}
