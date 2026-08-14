import { IsIn, IsUUID } from 'class-validator';
import { GRANTABLE_MODULES, type GrantableModule } from '../module-access.constants';

export class GrantModuleAccessDto {
  @IsUUID()
  employeeId: string;

  @IsIn(GRANTABLE_MODULES)
  module: GrantableModule;
}
