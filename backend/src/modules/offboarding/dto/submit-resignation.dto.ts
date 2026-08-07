import { IsInt, IsOptional, IsUUID, Min } from 'class-validator';

export class SubmitResignationDto {
  // Self-service is the common case; HR can submit on an employee's behalf.
  @IsOptional()
  @IsUUID()
  employeeId?: string;

  // Section 7.10: "notice period (per grade/policy)" — no grade-based
  // policy table exists yet, so this is supplied directly, same as e.g.
  // Shift.halfDayHours or LeaveType.accrualRate elsewhere in this codebase.
  @IsInt()
  @Min(0)
  noticePeriodDays: number;
}
