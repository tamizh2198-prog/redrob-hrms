import { Transform, Type } from "class-transformer";
import { IsArray, IsBoolean, IsEnum, IsInt, IsOptional, IsString, Min } from "class-validator";
import { NotificationChannel } from "@prisma/client";

export class ListInboxQueryDto {
  @IsOptional()
  @Transform(({ value }) => value === "true")
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

export class UpdatePreferencesDto {
  @IsString()
  eventCategory: string;

  @IsArray()
  @IsEnum(NotificationChannel, { each: true })
  channelsEnabled: NotificationChannel[];
}
