import { IsBoolean, IsDateString, IsIn, IsNumber, IsOptional, IsString, IsUUID } from "class-validator";

export class CreateAssetDto {
  @IsOptional()
  @IsUUID()
  companyId?: string;

  @IsString()
  category: string;

  @IsOptional()
  @IsString()
  make?: string;

  @IsOptional()
  @IsString()
  model?: string;

  @IsOptional()
  @IsString()
  serialNumber?: string;

  @IsOptional()
  @IsDateString()
  purchaseDate?: string;

  @IsOptional()
  @IsNumber()
  cost?: number;

  @IsOptional()
  @IsDateString()
  warrantyExpiry?: string;
}

export class CreateAssetRequestDto {
  @IsString()
  assetCategory: string;

  @IsOptional()
  @IsString()
  justification?: string;
}

export class DecideAssetRequestDto {
  @IsBoolean()
  approve: boolean;
}

export class IssueAssetDto {
  @IsUUID()
  employeeId: string;
}

export class ReturnAssetDto {
  @IsOptional()
  @IsIn(["GOOD", "DAMAGED"])
  condition?: "GOOD" | "DAMAGED";

  @IsOptional()
  @IsString()
  remarks?: string;
}
