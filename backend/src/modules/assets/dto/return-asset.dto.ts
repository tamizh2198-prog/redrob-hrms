import { IsIn, IsOptional, IsString } from 'class-validator';

export class ReturnAssetDto {
  @IsOptional()
  @IsIn(['GOOD', 'DAMAGED'])
  condition?: 'GOOD' | 'DAMAGED';

  @IsOptional()
  @IsString()
  remarks?: string;
}
