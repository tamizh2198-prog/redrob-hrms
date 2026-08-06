import { ArrayMinSize, IsArray, IsInt, Max, Min } from 'class-validator';

export class UpdateHybridPolicyDto {
  // Weekdays employees are expected in office: 0=Sun .. 6=Sat.
  @IsArray()
  @ArrayMinSize(1)
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  officeWeekdays: number[];
}
