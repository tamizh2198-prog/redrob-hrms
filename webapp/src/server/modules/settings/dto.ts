import { IsBoolean, IsEnum, IsInt, IsObject, IsOptional, IsString, Max, Min } from "class-validator";
import { IntegrationStatus } from "@prisma/client";

export class UpdateCompanySettingsDto {
  @IsOptional()
  @IsString()
  logoUrl?: string;

  @IsOptional()
  @IsString()
  primaryColor?: string;

  @IsOptional()
  @IsString()
  timezone?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(12)
  fiscalYearStartMonth?: number;
}

export class CreateOrgUnitDto {
  @IsString()
  name: string;

  @IsString()
  code: string;

  // Only meaningful for type "department" — ignored for the other three.
  @IsOptional()
  @IsString()
  parentId?: string;
}

export class UpdateOrgUnitDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  code?: string;

  // Only meaningful for type "department" — ignored for the other three.
  @IsOptional()
  @IsString()
  parentId?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  // Business Rule: deactivating an org unit with active employees requires
  // explicit confirmation — must be true to deactivate a unit that still has
  // employees assigned to it.
  @IsOptional()
  @IsBoolean()
  force?: boolean;
}

export class UpdateIntegrationDto {
  @IsEnum(IntegrationStatus)
  status: IntegrationStatus;

  // Non-secret labels only (e.g. a webhook URL, tenant domain) — nothing
  // here should ever hold a real credential.
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class ConfirmPilotDataResetDto {
  @IsString()
  confirmationPhrase: string;
}
