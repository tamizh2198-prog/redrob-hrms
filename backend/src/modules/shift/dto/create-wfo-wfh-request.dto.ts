import { WorkMode } from '@prisma/client';
import { IsDateString, IsEnum, IsString } from 'class-validator';

export class CreateWfoWfhRequestDto {
  @IsDateString()
  originalDate: string;

  @IsEnum(WorkMode)
  requestedWorkMode: WorkMode;

  @IsDateString()
  compensatoryDate: string;

  @IsString()
  reason: string;
}
