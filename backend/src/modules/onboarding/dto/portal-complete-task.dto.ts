import { IsString } from 'class-validator';

export class PortalCompleteTaskDto {
  @IsString()
  token: string;
}
