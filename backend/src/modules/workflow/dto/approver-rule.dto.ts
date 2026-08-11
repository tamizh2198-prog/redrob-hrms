import { IsEnum, IsIn, IsOptional } from 'class-validator';
import { Role } from '@prisma/client';

export class ApproverRuleDto {
  @IsIn(['MANAGER', 'SKIP_MANAGER', 'ROLE'])
  type: 'MANAGER' | 'SKIP_MANAGER' | 'ROLE';

  @IsOptional()
  @IsEnum(Role)
  role?: Role;
}
