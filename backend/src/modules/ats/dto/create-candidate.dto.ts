import { IsEmail, IsOptional, IsString, IsUUID } from 'class-validator';

export class CreateCandidateDto {
  @IsUUID()
  requisitionId: string;

  @IsString()
  name: string;

  @IsEmail()
  email: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  resumeRef?: string;

  @IsOptional()
  @IsString()
  source?: string;
}
