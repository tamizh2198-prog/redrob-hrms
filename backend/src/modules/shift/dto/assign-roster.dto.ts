import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
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

  // Allows a Super Admin to push a roster change onto an already-locked
  // attendance period (Section 7.4 Business Rules).
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  overrideLock?: boolean;
}
