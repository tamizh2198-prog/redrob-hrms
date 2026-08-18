import { IsString } from 'class-validator';

export class ConfirmPilotDataResetDto {
  @IsString()
  confirmationPhrase: string;
}
