import { IsDateString, IsString } from 'class-validator';

export class CreateCompOffRequestDto {
  @IsDateString()
  workedDate: string;

  @IsString()
  reason: string;
}
