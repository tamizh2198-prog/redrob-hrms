import { SetMetadata } from '@nestjs/common';

export const MODULE_KEY = 'requiresModule';

// Opt-in only — apply alongside @Roles() to the module-scoped routes a
// Super Admin should be able to grant a specific employee into, bypassing
// that employee's own role. Deliberately NOT applied to platform-admin
// actions (employee deletion, role/permission management, MFA, invites) —
// a module grant is an exception to one module's access, never a path to
// broader administrative capability. See RolesGuard for the enforcement and
// ModuleAccessService.MODULES for the fixed list of grantable module keys.
export const RequiresModule = (module: string) => SetMetadata(MODULE_KEY, module);
