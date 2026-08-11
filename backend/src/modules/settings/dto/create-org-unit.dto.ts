import { IsOptional, IsString } from 'class-validator';

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
