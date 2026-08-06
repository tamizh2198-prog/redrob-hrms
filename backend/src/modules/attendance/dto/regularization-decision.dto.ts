import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class RegularizationDecisionDto {
  @IsBoolean()
  approve: boolean;

  @IsOptional()
  @IsString()
  comment?: string;
}
