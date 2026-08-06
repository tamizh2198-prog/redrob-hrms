import { IsDateString, IsUUID } from 'class-validator';

export class ScheduleInterviewDto {
  @IsUUID()
  interviewerId: string;

  @IsDateString()
  scheduledAt: string;
}
