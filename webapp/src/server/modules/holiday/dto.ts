import { Type } from "class-transformer";
import { ArrayMinSize, IsBoolean, IsDateString, IsInt, IsOptional, IsString, IsUUID, ValidateNested } from "class-validator";

export class HolidayEntryDto {
  @IsDateString()
  date: string;

  @IsString()
  name: string;

  @IsOptional()
  @IsBoolean()
  isOptional?: boolean;
}

export class CreateHolidayCalendarDto {
  @IsUUID()
  locationId: string;

  @IsInt()
  year: number;

  @ValidateNested({ each: true })
  @Type(() => HolidayEntryDto)
  @ArrayMinSize(1)
  holidays: HolidayEntryDto[];
}

export class SelectOptionalHolidayDto {
  @IsUUID()
  holidayId: string;
}
