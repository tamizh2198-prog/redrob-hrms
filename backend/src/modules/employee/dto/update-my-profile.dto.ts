import {
  IsDateString,
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
} from 'class-validator';
import { BloodGroup, Gender } from '@prisma/client';

// Auth Phase 3: this is the ENTIRE self-service profile whitelist. Nothing
// beyond what's declared here can reach EmployeeService.updateMyProfile —
// role/employeeCode/companyId/departmentId/locationId/reportingManagerId/
// status/passwordHash are deliberately absent, and the global
// ValidationPipe({ whitelist: true }) strips any other property the
// client sends before it even reaches the controller.
//
// ifscCode/bloodGroup were added here (moved off the PATCH /employees/:id
// change-request path — see SELF_SERVICE_FIELDS) so My Profile is the one
// self-service surface for every personal/payroll field, per the "no
// duplicate editable surfaces" requirement.
export class UpdateMyProfileDto {
  @IsOptional()
  @IsDateString()
  dob?: string;

  @IsOptional()
  @IsEnum(Gender)
  gender?: Gender;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsEmail()
  personalEmail?: string;

  @IsOptional()
  @IsString()
  addressLine?: string;

  @IsOptional()
  @IsString()
  city?: string;

  @IsOptional()
  @IsString()
  state?: string;

  @IsOptional()
  @IsString()
  country?: string;

  @IsOptional()
  @IsString()
  postalCode?: string;

  @IsOptional()
  @IsString()
  pan?: string;

  @IsOptional()
  @IsString()
  aadhaar?: string;

  @IsOptional()
  @IsString()
  bankAccountNumber?: string;

  @IsOptional()
  @IsString()
  ifscCode?: string;

  @IsOptional()
  @IsEnum(BloodGroup)
  bloodGroup?: BloodGroup;

  @IsOptional()
  @IsString()
  emergencyContactName?: string;

  @IsOptional()
  @IsString()
  emergencyContactPhone?: string;
}
