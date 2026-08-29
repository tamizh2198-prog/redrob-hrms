import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class SubmitProbationFeedbackDto {
  @IsInt()
  @Min(1)
  @Max(5)
  companyRating: number;

  @IsInt()
  @Min(1)
  @Max(5)
  workCultureRating: number;

  @IsOptional()
  @IsString()
  comments?: string;
}
