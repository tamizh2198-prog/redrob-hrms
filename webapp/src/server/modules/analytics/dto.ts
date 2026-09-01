import { Type } from "class-transformer";
import { ArrayMinSize, IsArray, IsDateString, IsIn, IsOptional, IsString, IsUUID, ValidateNested } from "class-validator";
import type { ReportSchedule } from "@prisma/client";

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
  @IsUUID()
  locationId?: string;

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
  // three values return a file download instead.
  @IsOptional()
  @IsIn(["csv", "excel", "pdf"])
  format?: "csv" | "excel" | "pdf";
}

export class CreateSavedReportDto {
  @IsString()
  name: string;

  // Re-run verbatim on every scheduled send; `format` is meaningless here
  // and simply ignored if sent.
  @ValidateNested()
  @Type(() => BuildReportDto)
  config: BuildReportDto;

  @IsIn(["DAILY", "WEEKLY", "MONTHLY"])
  schedule: ReportSchedule;

  // These ids are only a starting point — the scheduler re-checks each
  // recipient's CURRENT role before every send.
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID("4", { each: true })
  recipientIds: string[];
}
