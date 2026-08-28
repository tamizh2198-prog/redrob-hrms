export type Role = 'EMPLOYEE' | 'MANAGER' | 'HR_ADMIN' | 'SUPER_ADMIN'

// Access to the operational HR modules — Onboarding, Offboarding, Assets —
// mirroring the backend RolesGuard's ROLE_DEFAULT_MODULES map. Do NOT use
// this for Employee Directory, CTC, Leave Type management, Settings,
// Roles & Permissions, or Audit — those stay on the existing
// HR_ADMIN/SUPER_ADMIN-only checks (`role === 'HR_ADMIN' || role ===
// 'SUPER_ADMIN'`), unchanged.
export function canAccessHrOperationalModules(role: Role | undefined): boolean {
  return role === 'HR_ADMIN' || role === 'SUPER_ADMIN'
}
