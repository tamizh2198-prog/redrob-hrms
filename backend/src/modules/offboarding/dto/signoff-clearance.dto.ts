import { IsOptional, IsString } from 'class-validator';

export class SignoffClearanceDto {
  @IsOptional()
  @IsString()
  remarks?: string;
}
