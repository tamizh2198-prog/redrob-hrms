import { IsUUID } from 'class-validator';

export class SelectOptionalHolidayDto {
  @IsUUID()
  holidayId: string;
}
