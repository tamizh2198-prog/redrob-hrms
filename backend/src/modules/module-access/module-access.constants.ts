// This task (Super Admin per-employee module access): the fixed set of
// modules a Super Admin can grant an individual employee into, regardless
// of that employee's own role. Matches the app's sidebar sections that
// have a real @Roles()-gated action worth granting into — deliberately
// excludes Employee (invite/delete/reveal-sensitive-fields live there) and
// Audit Logs (must stay admin-only), since a module grant is meant to
// extend day-to-day operational access, not administrative capability.
export const GRANTABLE_MODULES = [
  'ATTENDANCE',
  'SHIFT',
  'HOLIDAY',
  'ATS',
  'ONBOARDING',
  'PERFORMANCE',
  'ASSETS',
  'OFFBOARDING',
  'HELPDESK',
  'ANNOUNCEMENTS',
  'ANALYTICS',
  'WORKFLOW',
] as const;

export type GrantableModule = (typeof GRANTABLE_MODULES)[number];
