import { IsBoolean, IsOptional, IsString, MinLength } from 'class-validator';

export class UpdateOfferTemplateDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  subject?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  body?: string;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}
