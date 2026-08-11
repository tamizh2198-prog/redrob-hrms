import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, Min } from 'class-validator';

export class ListInboxQueryDto {
  @IsOptional()
  @Transform(({ value }) => value === 'true')
  @IsBoolean()
  unreadOnly?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pageSize?: number;
}
