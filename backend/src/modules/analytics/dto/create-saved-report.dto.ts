import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { ReportSchedule } from '@prisma/client';
import { BuildReportDto } from './build-report.dto';

export class CreateSavedReportDto {
  @IsString()
  name: string;

  // Re-run verbatim on every scheduled send; `format` is meaningless here
  // and simply ignored if sent.
  @ValidateNested()
  @Type(() => BuildReportDto)
  config: BuildReportDto;

  @IsIn(['DAILY', 'WEEKLY', 'MONTHLY'])
  schedule: ReportSchedule;

  // Section 7.13 Phase 5 AC-3: these ids are only a starting point — the
  // scheduler re-checks each recipient's CURRENT role before every send.
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('4', { each: true })
  recipientIds: string[];
}
