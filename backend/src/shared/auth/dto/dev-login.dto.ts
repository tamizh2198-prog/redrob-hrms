import { IsString } from 'class-validator';

export class DevLoginDto {
  @IsString()
  employeeCode: string;
}
