import { IsString } from 'class-validator';

export class PreboardSubmitDto {
  @IsString()
  token: string;

  @IsString()
  fieldType: string;

  @IsString()
  valueRef: string;
}
