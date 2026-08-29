import { IsBoolean, IsOptional, IsString } from 'class-validator';

// Identical shape to AuditMonthlyEvaluationDto — same audit flow, different
// underlying record.
export class AuditQuarterlyKpiDto {
  @IsBoolean()
  approve: boolean;

  @IsOptional()
  @IsString()
  auditNotes?: string;
}
