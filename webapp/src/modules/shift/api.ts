import { api, ApiError } from '@/lib/api'

export interface Shift {
  id: string
  name: string
  startTime: string
  endTime: string
  graceMinutes: number
  halfDayHours: number
  isNightShift: boolean
}

export interface RosterEntry {
  id: string
  employeeId: string
  date: string
  isWeekOff: boolean
  workMode: 'OFFICE' | 'WORK_FROM_HOME'
  shift: Shift | null
}

export interface HybridSchedule {
  officeWeekdays: number[]
}

export interface WfoWfhRequest {
  id: string
  employeeId: string
  employee?: { firstName: string; lastName: string; employeeCode: string }
  originalDate: string
  requestedWorkMode: 'OFFICE' | 'WORK_FROM_HOME'
  compensatoryDate: string
  compensatoryWorkMode: 'OFFICE' | 'WORK_FROM_HOME'
  reason: string
  status: 'PENDING_MANAGER' | 'PENDING_FINAL_APPROVAL' | 'APPROVED' | 'REJECTED'
  approverId: string | null
  approverName: string | null
  managerApproverId: string | null
  managerDecidedAt: string | null
  finalApproverId: string | null
  createdAt: string
}

export interface WfoWfhComment {
  id: string
  authorId: string
  body: string
  createdAt: string
}

export function listShifts() {
  return api<Shift[]>('/shifts')
}

export function createShift(data: Partial<Shift>) {
  return api<Shift>('/shifts', { method: 'POST', body: data })
}

export function assignRoster(data: {
  employeeIds: string[]
  dates: string[]
  shiftId?: string
  isWeekOff?: boolean
  workMode?: 'OFFICE' | 'WORK_FROM_HOME'
}) {
  return api<{ successCount: number; failureCount: number; results: unknown[] }>(
    '/roster/assign',
    { method: 'POST', body: data },
  )
}

export function getRoster(employeeId: string, from: string, to: string) {
  return api<RosterEntry[]>(`/roster/${employeeId}`, { params: { from, to } })
}

export function getHybridSchedule(employeeId: string, year: number, month: number) {
  return api<HybridSchedule>('/roster/hybrid-schedule', {
    params: { employeeId, year: String(year), month: String(month) },
  })
}

export function setHybridSchedule(data: {
  employeeId: string
  year: number
  month: number
  officeWeekdays: number[]
}) {
  return api<HybridSchedule & { daysUpdated: number }>('/roster/hybrid-schedule', {
    method: 'POST',
    body: data,
  })
}

export interface BulkWfoRowResult {
  row: number
  success: boolean
  employeeId?: string
  errors?: string[]
}

export interface BulkWfoUploadResult {
  totalRows: number
  successCount: number
  failureCount: number
  dryRun: boolean
  results: BulkWfoRowResult[]
}

// Bypasses the shared api() helper (which always JSON-encodes the body) —
// this sends a real file as multipart form data. Relative URL now that
// frontend+backend are one Next.js app.
export async function bulkUploadWfoSchedule(file: File, dryRun: boolean) {
  const form = new FormData()
  form.append('file', file)
  const res = await fetch(
    `/api/v1/roster/hybrid-schedule/bulk-upload?dryRun=${dryRun}`,
    {
      method: 'POST',
      credentials: 'same-origin',
      body: form,
    },
  )
  if (!res.ok) {
    const body = await res.json().catch(() => ({ message: res.statusText }))
    throw new ApiError(body.message ?? 'Bulk upload failed', res.status)
  }
  return res.json() as Promise<BulkWfoUploadResult>
}

export function submitWfoWfhRequest(data: {
  originalDate: string
  requestedWorkMode: 'OFFICE' | 'WORK_FROM_HOME'
  compensatoryDate: string
  reason: string
}) {
  return api<WfoWfhRequest>('/wfo-wfh-requests', { method: 'POST', body: data })
}

export function myWfoWfhRequests() {
  return api<WfoWfhRequest[]>('/wfo-wfh-requests/mine')
}

export function pendingWfoWfhRequestsForMe() {
  return api<WfoWfhRequest[]>('/wfo-wfh-requests/pending-for-me')
}

// Visibility-only for Super Admin/HR Admin — these are still awaiting the
// manager's decision and aren't actionable yet.
export function pendingWfoWfhManagerStageForVisibility() {
  return api<WfoWfhRequest[]>('/wfo-wfh-requests/pending-manager-stage')
}

export function pendingWfoWfhFinalApproval() {
  return api<WfoWfhRequest[]>('/wfo-wfh-requests/pending-final-approval')
}

export function decideWfoWfhRequest(id: string, approve: boolean, comment?: string) {
  return api<{ status: string }>(`/wfo-wfh-requests/${id}/decision`, {
    method: 'POST',
    body: { approve, comment },
  })
}

export function listAllWfoWfhRequests(status?: string) {
  return api<WfoWfhRequest[]>('/wfo-wfh-requests', { params: status ? { status } : undefined })
}

export function addWfoWfhComment(id: string, body: string) {
  return api<WfoWfhComment>(`/wfo-wfh-requests/${id}/comments`, {
    method: 'POST',
    body: { body },
  })
}

export function listWfoWfhComments(id: string) {
  return api<WfoWfhComment[]>(`/wfo-wfh-requests/${id}/comments`)
}

export async function downloadWfoTemplate() {
  const res = await fetch('/api/v1/roster/hybrid-schedule/template', { credentials: 'same-origin' })
  if (!res.ok) throw new ApiError('Failed to download template', res.status)

  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = 'wfo-days-template.xlsx'
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}
