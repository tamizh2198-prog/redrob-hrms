import { IsArray, IsEnum, IsString } from 'class-validator';
import { NotificationChannel } from '@prisma/client';

export class UpdatePreferencesDto {
  @IsString()
  eventCategory: string;

  @IsArray()
  @IsEnum(NotificationChannel, { each: true })
  channelsEnabled: NotificationChannel[];
}
