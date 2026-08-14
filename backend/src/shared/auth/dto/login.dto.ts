import { IsEmail, IsOptional, IsString } from 'class-validator';

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
