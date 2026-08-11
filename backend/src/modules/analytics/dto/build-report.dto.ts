import {
  IsArray,
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';

export class BuildReportDto {
  // Validated against REPORT_ENTITIES in the service, not an enum here —
  // the whitelist is meant to grow without a migration/DTO change.
  @IsString()
  entity: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  fields?: string[];

  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @IsOptional()
  @IsDateString()
  dateTo?: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  groupBy?: string;

  // 'json' (default, omit this field) returns the report inline; the other
  // three values return a file download instead — Section 7.13 Phase 4.
  @IsOptional()
  @IsIn(['csv', 'excel', 'pdf'])
  format?: 'csv' | 'excel' | 'pdf';
}
