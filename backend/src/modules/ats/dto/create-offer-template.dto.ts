import { IsBoolean, IsOptional, IsString, MinLength } from 'class-validator';

export class CreateOfferTemplateDto {
  @IsString()
  @MinLength(1)
  name: string;

  @IsString()
  @MinLength(1)
  subject: string;

  @IsString()
  @MinLength(1)
  body: string;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}
