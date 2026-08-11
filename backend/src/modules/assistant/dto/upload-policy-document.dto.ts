import { IsString } from 'class-validator';

export class UploadPolicyDocumentDto {
  @IsString()
  title: string;

  @IsString()
  content: string;
}
