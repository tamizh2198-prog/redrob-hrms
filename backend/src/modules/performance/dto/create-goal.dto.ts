import { IsNumber, IsOptional, IsString, IsUUID, Min } from 'class-validator';

export class CreateGoalDto {
  // Defaults to the actor's own id when omitted — self-service goal
  // setting is the common case (Section 7.8 User Story).
  @IsOptional()
  @IsUUID()
  employeeId?: string;

  @IsUUID()
  cycleId: string;

  @IsOptional()
  @IsUUID()
  parentGoalId?: string;

  @IsString()
  title: string;

  @IsOptional()
  @IsNumber()
  target?: number;

  @IsNumber()
  @Min(0)
  weightage: number;
}
