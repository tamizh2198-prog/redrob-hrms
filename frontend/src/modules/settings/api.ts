import { api, ApiError } from '@/lib/api'

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3001/api/v1'

export interface CompanySettings {
  id: string
  companyId: string
  logoUrl: string | null
  primaryColor: string | null
  timezone: string
  fiscalYearStartMonth: number
  updatedAt: string
}

export type OrgUnitType = 'department' | 'location' | 'designation' | 'grade'

export interface OrgUnit {
  id: string
  companyId: string
  name: string
  code: string
  parentId?: string | null
  isActive: boolean
}

export interface OrgStructure {
  departments: OrgUnit[]
  locations: OrgUnit[]
  designations: OrgUnit[]
  grades: OrgUnit[]
}

export type IntegrationType =
  | 'GOOGLE_SSO'
  | 'SLACK'
  | 'SMS_GATEWAY'
  | 'EMAIL_GATEWAY'
  | 'BIOMETRIC'

export type IntegrationStatus = 'NOT_CONFIGURED' | 'CONFIGURED' | 'ERROR'

export interface IntegrationConfig {
  companyId: string
  type: IntegrationType
  status: IntegrationStatus
  metadata: Record<string, unknown> | null
}

export function getCompanySettings() {
  return api<CompanySettings>('/settings/company')
}

export function updateCompanySettings(data: {
  logoUrl?: string
  primaryColor?: string
  timezone?: string
  fiscalYearStartMonth?: number
}) {
  return api<CompanySettings>('/settings/company', { method: 'PATCH', body: data })
}

export function listOrgStructure() {
  return api<OrgStructure>('/settings/org-structure')
}

export function createOrgUnit(
  type: OrgUnitType,
  data: { name: string; code: string; parentId?: string },
) {
  return api<OrgUnit>(`/settings/org-structure/${type}`, { method: 'POST', body: data })
}

export function updateOrgUnit(
  type: OrgUnitType,
  id: string,
  data: { name?: string; code?: string; parentId?: string; isActive?: boolean; force?: boolean },
) {
  return api<OrgUnit>(`/settings/org-structure/${type}/${id}`, { method: 'PATCH', body: data })
}

export function listIntegrations() {
  return api<IntegrationConfig[]>('/settings/integrations')
}

export function updateIntegration(
  type: IntegrationType,
  data: { status: IntegrationStatus; metadata?: Record<string, unknown> },
) {
  return api<IntegrationConfig>(`/settings/integrations/${type}`, {
    method: 'PATCH',
    body: data,
  })
}

// Bypasses the shared api() helper (JSON-only) — downloads the backup file
// straight to the browser, same pattern as the Attendance module's
// downloadBiometricTemplate().
export async function downloadBackup() {
  const token = localStorage.getItem('accessToken')
  const res = await fetch(`${API_URL}/settings/backup`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
  if (!res.ok) throw new ApiError('Failed to download backup', res.status)

  const disposition = res.headers.get('Content-Disposition') ?? ''
  const filenameMatch = disposition.match(/filename="([^"]+)"/)
  const filename = filenameMatch?.[1] ?? 'redrob-hrms-backup.json'

  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}
