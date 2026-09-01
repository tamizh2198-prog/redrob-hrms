import { IsEmail, IsOptional, IsString, MinLength } from "class-validator";

export class LoginDto {
  @IsEmail()
  email: string;

  @IsString()
  password: string;

  // Presented by a machine that already completed MFA here before — lets
  // that login skip straight through instead of hitting enroll/verify
  // again. Omit (or present an unrecognized one) and the normal MFA flow
  // runs exactly as before.
  @IsOptional()
  @IsString()
  deviceToken?: string;
}

export class MfaCodeDto {
  @IsString()
  mfaToken: string;

  @IsString()
  code: string;
}

export class RefreshTokenDto {
  @IsString()
  refreshToken: string;
}

export class DevLoginDto {
  @IsString()
  employeeCode: string;
}

export class ActivateAccountDto {
  @IsString()
  token: string;

  @IsString()
  @MinLength(8)
  password: string;

  @IsString()
  confirmPassword: string;
}

export class ConsumePasswordResetDto {
  @IsString()
  token: string;

  @IsString()
  @MinLength(8)
  password: string;

  @IsString()
  confirmPassword: string;
}

export class ForgotPasswordDto {
  @IsEmail()
  email: string;
}

export class BootstrapSuperAdminDto {
  @IsString()
  firstName: string;

  @IsString()
  lastName: string;

  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8)
  password: string;
}
