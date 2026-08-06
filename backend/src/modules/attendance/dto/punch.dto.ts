import { IsIn } from 'class-validator';

export class PunchDto {
  @IsIn(['IN', 'OUT'])
  type: 'IN' | 'OUT';
}
