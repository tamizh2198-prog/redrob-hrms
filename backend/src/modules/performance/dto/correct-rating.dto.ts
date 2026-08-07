import { IsNumber, IsString } from 'class-validator';

export class CorrectRatingDto {
  @IsNumber()
  newRating: number;

  @IsString()
  reason: string;
}
