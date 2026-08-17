import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class WfoWfhDecisionDto {
  @IsBoolean()
  approve: boolean;

  @IsOptional()
  @IsString()
  comment?: string;
}
