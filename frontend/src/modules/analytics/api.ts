import { api, ApiError } from '@/lib/api'

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3001/api/v1'

export interface EmployeeDashboard {
  role: 'EMPLOYEE'
  leaveBalances: Array<{ leaveType: string; available: number }>
  pendingLeaveApplications: number
  myOpenTickets: number
}

export interface ManagerDashboard {
  role: 'MANAGER'
  teamSize: number
  attendanceToday: Array<{ status: string; count: number }>
  pendingApprovalsCount: number
  teamGoalProgressPercent: number | null
  teamMembers: Array<{
    id: string
    employeeCode: string
    firstName: string
    lastName: string
    status: string
    photoUrl: string | null
    designation: string | null
    department: string | null
  }>
}

export interface HrAdminDashboard {
  role: 'HR_ADMIN' | 'SUPER_ADMIN'
  headcountByStatus: Array<{ status: string; count: number }>
  attritionLast90Days: number
  hiringFunnel: Array<{ stage: string; count: number }>
  openRequisitions: number
  leaveLiabilityDays: number
  // Phase 6C
  attendanceToday: Array<{ status: string; count: number }>
  attendancePercentToday: number | null
}

export type Dashboard = EmployeeDashboard | ManagerDashboard | HrAdminDashboard

export interface ReportEntity {
  key: string
  label: string
  fields: string[]
  groupableFields: string[]
}

export interface ReportRow {
  id: string
  [field: string]: unknown
}

export interface ReportGroup {
  key: string
  count: number
  recordIds: string[]
}

export interface ReportResult {
  entity: string
  total: number
  rows: ReportRow[]
  groups?: ReportGroup[]
}

export function getDashboard() {
  return api<Dashboard>('/analytics/dashboard')
}

export function listReportEntities() {
  return api<ReportEntity[]>('/analytics/reports/entities')
}

export interface BuildReportParams {
  entity: string
  fields?: string[]
  departmentId?: string
  dateFrom?: string
  dateTo?: string
  status?: string
  groupBy?: string
}

export function buildReport(data: BuildReportParams) {
  return api<ReportResult>('/analytics/reports/build', { method: 'POST', body: data })
}

export type ExportFormat = 'csv' | 'excel' | 'pdf'

// Bypasses the shared `api()` helper (which always JSON-parses the body) —
// exports come back as a file, so this needs the raw Response to read a Blob.
export async function exportReport(data: BuildReportParams, format: ExportFormat) {
  const token = localStorage.getItem('accessToken')
  const res = await fetch(`${API_URL}/analytics/reports/build`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ ...data, format }),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({ message: res.statusText }))
    throw new ApiError(body.message ?? 'Export failed', res.status)
  }
  const blob = await res.blob()
  const disposition = res.headers.get('Content-Disposition') ?? ''
  const match = /filename="([^"]+)"/.exec(disposition)
  const filename = match?.[1] ?? `${data.entity}-report.${format}`

  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

export type ReportSchedule = 'DAILY' | 'WEEKLY' | 'MONTHLY'

export interface SavedReport {
  id: string
  name: string
  config: BuildReportParams
  schedule: ReportSchedule
  recipientIds: string[]
  lastRunAt: string | null
  createdAt: string
}

export function listSavedReports() {
  return api<SavedReport[]>('/analytics/reports/saved')
}

export function createSavedReport(data: {
  name: string
  config: BuildReportParams
  schedule: ReportSchedule
  recipientIds: string[]
}) {
  return api<SavedReport>('/analytics/reports/saved', { method: 'POST', body: data })
}

export function deleteSavedReport(id: string) {
  return api<void>(`/analytics/reports/saved/${id}`, { method: 'DELETE' })
}
