import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';

export class BiometricRowDto {
  @IsString()
  employeeCode: string;

  @IsDateString()
  date: string;

  @IsOptional()
  @IsDateString()
  checkInTime?: string;

  @IsOptional()
  @IsDateString()
  checkOutTime?: string;
}

export class ImportBiometricDto {
  @ValidateNested({ each: true })
  @Type(() => BiometricRowDto)
  @IsArray()
  @ArrayMinSize(1)
  rows: BiometricRowDto[];
}
