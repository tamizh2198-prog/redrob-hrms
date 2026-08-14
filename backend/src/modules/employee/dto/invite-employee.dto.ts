import {
  IsEmail,
  IsEnum,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
} from 'class-validator';
import { EmploymentType, Role } from '@prisma/client';

// Auth Phase 2: intentionally minimal — the full CreateEmployeeDto's
// mandatory-for-active fields (dob, PAN, bank details, ...) don't apply to
// an invited-but-not-yet-onboarded account. Profile completion is a later
// phase.
//
// This task (workflow correction): added the basic admin-assignable fields
// needed to make this the SINGLE employee-creation path — department,
// location, reporting manager, and role. role is deliberately optional and
// guarded server-side in EmployeeService.inviteEmployee: only a SUPER_ADMIN
// caller may assign HR_ADMIN/SUPER_ADMIN; defaults to EMPLOYEE otherwise.
export class InviteEmployeeDto {
  @IsEmail()
  email: string;

  @IsString()
  firstName: string;

  @IsString()
  lastName: string;

  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @IsOptional()
  @IsUUID()
  locationId?: string;

  @IsOptional()
  @IsUUID()
  reportingManagerId?: string;

  @IsOptional()
  @IsUUID()
  designationId?: string;

  @IsOptional()
  @IsUUID()
  gradeId?: string;

  @IsOptional()
  @IsEnum(EmploymentType)
  employmentType?: EmploymentType;

  @IsOptional()
  @IsEnum(Role)
  role?: Role;

  // Performance Evaluation Policy 2026 / P&B: current annual CTC in Lakhs —
  // determines which CTC band's quarterly KPI reward limit applies (see
  // PerformanceService's quarterly KPI reward calculation). Settable at
  // creation time here (in addition to the existing HR-only edit on the
  // Employee Detail page) since a quarterly reward can't be computed at
  // all until this is set.
  @IsOptional()
  @IsNumber()
  @IsPositive()
  ctcLpa?: number;
}
