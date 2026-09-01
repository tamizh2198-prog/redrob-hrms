import { Type } from "class-transformer";
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  Min,
} from "class-validator";
import { WorkMode } from "@prisma/client";

export class AssignRosterDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID("all", { each: true })
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
  // auto-derived from the company's hybrid policy.
  @IsOptional()
  @IsEnum(WorkMode)
  workMode?: WorkMode;

  // Allows a Super Admin to push a roster change onto an already-locked
  // attendance period.
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  overrideLock?: boolean;
}

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

export class CreateShiftDto {
  @IsOptional()
  @IsString()
  companyId?: string;

  @IsString()
  name: string;

  @Matches(HHMM, { message: "startTime must be in HH:mm format" })
  startTime: string;

  @Matches(HHMM, { message: "endTime must be in HH:mm format" })
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

export class CreateWfoWfhRequestDto {
  @IsDateString()
  originalDate: string;

  @IsEnum(WorkMode)
  requestedWorkMode: WorkMode;

  @IsDateString()
  compensatoryDate: string;

  @IsString()
  reason: string;
}

export class SetHybridScheduleDto {
  @IsUUID()
  employeeId: string;

  @IsInt()
  @Min(2000)
  year: number;

  @IsInt()
  @Min(1)
  @Max(12)
  month: number;

  // This employee's office weekdays for the month: 0=Sun .. 6=Sat.
  @IsArray()
  @ArrayMinSize(1)
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  officeWeekdays: number[];
}

export class WfoWfhDecisionDto {
  @IsBoolean()
  approve: boolean;

  @IsOptional()
  @IsString()
  comment?: string;
}
