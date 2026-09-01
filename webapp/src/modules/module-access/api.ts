import { api } from '@/lib/api'

// Matches backend GRANTABLE_MODULES (module-access.constants.ts) — deliberately
// excludes Employee (invite/delete/reveal-sensitive-fields) and Audit Logs.
export const GRANTABLE_MODULES = [
  'SHIFT',
  'HOLIDAY',
  'ATS',
  'ONBOARDING',
  'PERFORMANCE',
  'OFFBOARDING',
  'HELPDESK',
  'ANNOUNCEMENTS',
  'ANALYTICS',
  'WORKFLOW',
] as const

export type GrantableModule = (typeof GRANTABLE_MODULES)[number]

export const MODULE_LABELS: Record<GrantableModule, string> = {
  SHIFT: 'Shift & Roster',
  HOLIDAY: 'Holiday Calendar',
  ATS: 'Recruitment (ATS)',
  ONBOARDING: 'Onboarding',
  PERFORMANCE: 'Performance',
  OFFBOARDING: 'Offboarding',
  HELPDESK: 'Helpdesk',
  ANNOUNCEMENTS: 'Announcements',
  ANALYTICS: 'Analytics',
  WORKFLOW: 'Workflow',
}

export interface ModuleAccessGrant {
  id: string
  employeeId: string
  module: GrantableModule
  grantedBy: string
  grantedAt: string
}

export function listGrantsForEmployee(employeeId: string) {
  return api<ModuleAccessGrant[]>(`/module-access/${employeeId}`)
}

export function grantModuleAccess(employeeId: string, module: GrantableModule) {
  return api<ModuleAccessGrant>('/module-access', { method: 'POST', body: { employeeId, module } })
}

export function revokeModuleAccess(employeeId: string, module: GrantableModule) {
  return api<{ revoked: boolean }>(`/module-access/${employeeId}/${module}`, { method: 'DELETE' })
}
