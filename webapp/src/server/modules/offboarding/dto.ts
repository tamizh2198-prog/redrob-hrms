import { Type } from "class-transformer";
import { IsBoolean, IsDateString, IsEmail, IsInt, IsNumber, IsObject, IsOptional, IsString, IsUUID, MaxLength, Min } from "class-validator";

export class SubmitResignationDto {
  // Self-service is the common case; HR can submit on an employee's behalf.
  @IsOptional()
  @IsUUID()
  employeeId?: string;

  // No grade-based notice-period policy table exists yet, so this is
  // supplied directly.
  @IsInt()
  @Min(0)
  noticePeriodDays: number;

  // Mandatory — the relieving/experience letter is sent here after
  // separation, once the employee has lost access to their work account.
  @IsEmail()
  personalEmail: string;
}

export class RejectResignationDto {
  @IsString()
  reason: string;
}

export class AdjustLwdDto {
  @IsDateString()
  newDate: string;

  @IsString()
  reason: string;
}

export class SignoffClearanceDto {
  @IsOptional()
  @IsString()
  remarks?: string;
}

export class SubmitExitInterviewDto {
  @IsObject()
  responses: Record<string, unknown>;
}

// F&F "automatically pulls" leave encashment and asset recovery from their
// own modules — no re-entry needed for those. The one number this system
// genuinely has no source for is a per-day pay rate (there's no payroll
// module), so HR supplies it here to convert the auto-pulled day counts and
// shortfall days into currency.
export class ComputeSettlementDto {
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  perDayPayRate: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  pendingSalary?: number;
}

export class MarkSettlementPaidDto {
  @IsOptional()
  @IsBoolean()
  rehireEligible?: boolean;
}

export class SendRelievingLetterDto {
  @IsOptional()
  @IsString()
  closingRemarks?: string;
}

// Every field the letter template actually prints, except employeeCode —
// that's the one immutable identifier on the letter, never something a
// typo/override should touch. The auto-generated snapshot (from whatever
// was on the employee's record when the clearance checklist completed) is
// often right, but not always: a blank "—" for a field that was never
// filled in, a department name that changed since, a designation that needs
// a manual correction — Super Admin can fix any of these before sending.
export class UpdateRelievingLetterDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  employeeName?: string;

  // Not @IsDateString(): the snapshot legitimately holds "—" for a field
  // that was never filled in, not always a real ISO date.
  @IsOptional()
  @IsString()
  @MaxLength(50)
  dateOfJoining?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  lastWorkingDay?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  designation?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  location?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  department?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  generatedDate?: string;
}
