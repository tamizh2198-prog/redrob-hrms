import { IsIn, IsString } from 'class-validator';

export class RespondOfferDto {
  @IsString()
  token: string;

  @IsIn(['ACCEPT', 'DECLINE'])
  decision: 'ACCEPT' | 'DECLINE';
}
