import { api, ApiError } from '@/lib/api'

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3001/api/v1'

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
// this sends a real file as multipart form data, same reasoning as
// analytics/api.ts's exportReport() bypassing it for blob downloads.
export async function bulkUploadWfoSchedule(file: File, dryRun: boolean) {
  const token = localStorage.getItem('accessToken')
  const form = new FormData()
  form.append('file', file)
  const res = await fetch(
    `${API_URL}/roster/hybrid-schedule/bulk-upload?dryRun=${dryRun}`,
    {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: form,
    },
  )
  if (!res.ok) {
    const body = await res.json().catch(() => ({ message: res.statusText }))
    throw new ApiError(body.message ?? 'Bulk upload failed', res.status)
  }
  return res.json() as Promise<BulkWfoUploadResult>
}

export async function downloadWfoTemplate() {
  const token = localStorage.getItem('accessToken')
  const res = await fetch(`${API_URL}/roster/hybrid-schedule/template`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
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
