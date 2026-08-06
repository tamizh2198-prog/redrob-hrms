import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsUUID,
  Max,
  Min,
} from 'class-validator';

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
