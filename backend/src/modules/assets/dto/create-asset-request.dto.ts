import { IsOptional, IsString } from 'class-validator';

export class CreateAssetRequestDto {
  @IsString()
  assetCategory: string;

  @IsOptional()
  @IsString()
  justification?: string;
}
