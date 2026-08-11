import { IsIn, IsNumber, IsString } from 'class-validator';

export class StepConditionDto {
  @IsString()
  field: string;

  @IsIn(['gt', 'gte', 'lt', 'lte', 'eq'])
  operator: 'gt' | 'gte' | 'lt' | 'lte' | 'eq';

  @IsNumber()
  value: number;
}
