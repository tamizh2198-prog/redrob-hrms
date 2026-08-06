import { Type } from 'class-transformer';
import { WorkMode } from '@prisma/client';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsOptional,
  IsUUID,
} from 'class-validator';

export class AssignRosterDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('all', { each: true })
  employeeIds: string[];

  @IsArray()
  @ArrayMinSize(1)
  @IsDateString({}, { each: true })
  dates: string[];

  @IsOptional()
  @IsUUID()
  shiftId?: string;

  @IsOptional()
  @IsBoolean()
  isWeekOff?: boolean;

  // Forces Office/WFH for this assignment. When omitted, workMode is
  // auto-derived from the company's hybrid policy (Section 7.4).
  @IsOptional()
  @IsEnum(WorkMode)
  workMode?: WorkMode;

  // Allows a Super Admin to push a roster change onto an already-locked
  // attendance period (Section 7.4 Business Rules).
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  overrideLock?: boolean;
}
