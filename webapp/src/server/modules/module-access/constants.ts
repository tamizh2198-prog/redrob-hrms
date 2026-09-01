// The fixed set of modules a Super Admin can grant an individual employee
// into, regardless of that employee's own role — deliberately excludes
// Employee and Audit Logs (must stay admin-only).
export const GRANTABLE_MODULES = [
  "SHIFT",
  "HOLIDAY",
  "ATS",
  "ONBOARDING",
  "PERFORMANCE",
  "OFFBOARDING",
  "HELPDESK",
  "ANNOUNCEMENTS",
  "ANALYTICS",
  "WORKFLOW",
] as const;

export type GrantableModule = (typeof GRANTABLE_MODULES)[number];
