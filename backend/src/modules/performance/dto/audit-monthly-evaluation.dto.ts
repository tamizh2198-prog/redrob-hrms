import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class AuditMonthlyEvaluationDto {
  @IsBoolean()
  approve: boolean;

  // Required by the service when approve is false — the manager needs a
  // reason to act on when resubmitting.
  @IsOptional()
  @IsString()
  auditNotes?: string;
}
