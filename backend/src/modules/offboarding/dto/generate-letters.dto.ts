import { IsOptional, IsString } from 'class-validator';

export class GenerateLettersDto {
  @IsOptional()
  @IsString()
  closingRemarks?: string;
}
