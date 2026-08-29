import { IsString } from 'class-validator';

export class SubmitCertificateDto {
  @IsString()
  certificateRef: string;
}
