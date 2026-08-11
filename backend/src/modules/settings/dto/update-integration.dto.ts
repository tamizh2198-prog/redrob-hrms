import { IsEnum, IsObject, IsOptional } from 'class-validator';
import { IntegrationStatus } from '@prisma/client';

export class UpdateIntegrationDto {
  @IsEnum(IntegrationStatus)
  status: IntegrationStatus;

  // Non-secret labels only (e.g. a webhook URL, tenant domain) — this app has
  // no OAuth/SMTP/SMS SDK installed, so there is nowhere to send real
  // credentials and nothing here should ever hold one.
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
