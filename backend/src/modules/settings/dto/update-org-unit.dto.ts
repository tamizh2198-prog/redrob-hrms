import { IsBoolean, IsOptional, IsString } from 'class-validator';

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

  // Section 7.17 Business Rule: "deactivating an org unit with active
  // employees requires explicit confirmation" — must be true to deactivate a
  // unit that still has employees assigned to it.
  @IsOptional()
  @IsBoolean()
  force?: boolean;
}
