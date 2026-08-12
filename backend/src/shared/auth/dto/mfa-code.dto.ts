import { IsString } from 'class-validator';

export class MfaCodeDto {
  @IsString()
  mfaToken: string;

  @IsString()
  code: string;
}
