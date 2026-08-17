import { api, ApiError } from '@/lib/api'

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3001/api/v1'

export type AttendanceStatus =
  | 'PRESENT'
  | 'ABSENT'
  | 'HALF_DAY'
  | 'LATE'
  | 'EARLY_EXIT'
  | 'ON_LEAVE'
  | 'HOLIDAY'
  | 'WEEK_OFF'
  | 'WFH'

// This task: a day later than today that has no attendance record yet
// isn't "absent" — it just hasn't happened. The backend's getCalendar()
// now reports this literal instead of ABSENT for such days; it's not a
// stored AttendanceStatus enum value, just a calendar display state.
export type CalendarDayStatus = AttendanceStatus | 'UPCOMING'

export interface CalendarDay {
  date: string
  status: CalendarDayStatus
  checkInTime: string | null
  checkOutTime: string | null
  workHours: number | null
  regularization: {
    status: 'PENDING' | 'APPROVED' | 'REJECTED'
    requestedStatus: AttendanceStatus
    reason: string
  } | null
  // Set when status is HOLIDAY — the Holiday Calendar entry's name, from
  // the same Holiday source Dashboard/HolidayPage read from.
  holidayName: string | null
}

export function formatDuration(workHours: number | null): string {
  if (workHours === null) return '—'
  const hours = Math.floor(workHours)
  const minutes = Math.round((workHours - hours) * 60)
  return `${hours}h ${minutes}m`
}

export function formatTime(value: string | null): string {
  if (!value) return '—'
  return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

// Shared presentation mapping — reused by the unified Attendance & Leave
// page and the Employee Profile Attendance section, so the status→color
// mapping is defined exactly once.
export const ATTENDANCE_STATUS_COLOR: Record<CalendarDayStatus, string> = {
  PRESENT: 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300',
  ABSENT: 'bg-destructive/20 text-destructive',
  HALF_DAY: 'bg-amber-500/20 text-amber-700 dark:text-amber-300',
  LATE: 'bg-orange-500/20 text-orange-700 dark:text-orange-300',
  EARLY_EXIT: 'bg-orange-500/20 text-orange-700 dark:text-orange-300',
  ON_LEAVE: 'bg-blue-500/20 text-blue-700 dark:text-blue-300',
  HOLIDAY: 'bg-purple-500/20 text-purple-700 dark:text-purple-300',
  WEEK_OFF: 'bg-muted text-muted-foreground',
  WFH: 'bg-cyan-500/20 text-cyan-700 dark:text-cyan-300',
  // No new colors — reuses the same neutral/muted styling as WEEK_OFF.
  UPCOMING: 'bg-muted text-muted-foreground',
}

export interface RegularizationRequest {
  id: string
  employeeId: string
  date: string
  requestedStatus: AttendanceStatus
  reason: string
  status: 'PENDING' | 'APPROVED' | 'REJECTED'
  createdAt: string
}

export function punch(type: 'IN' | 'OUT') {
  return api<{ status: AttendanceStatus }>('/attendance/punch', {
    method: 'POST',
    body: { type },
  })
}

export function getCalendar(employeeId: string, year: number, month: number) {
  return api<CalendarDay[]>(`/attendance/${employeeId}/calendar`, {
    params: { year: String(year), month: String(month) },
  })
}

export function regularize(data: {
  date: string
  requestedStatus: AttendanceStatus
  reason: string
}) {
  return api<RegularizationRequest>('/attendance/regularize', {
    method: 'POST',
    body: data,
  })
}

export function listRegularizations(params: {
  employeeId?: string
  approverId?: string
  status?: 'PENDING' | 'APPROVED' | 'REJECTED'
}) {
  return api<RegularizationRequest[]>('/attendance/regularize', { params })
}

export function decideRegularization(id: string, approve: boolean, comment?: string) {
  return api<{ status: string }>(`/attendance/regularize/${id}/decision`, {
    method: 'POST',
    body: { approve, comment },
  })
}

export function importBiometric(rows: Array<Record<string, string>>) {
  return api<{
    totalRows: number
    matchedCount: number
    unmatchedCount: number
    unmatched: Array<{ employeeCode: string; date: string }>
  }>('/attendance/import', { method: 'POST', body: { rows } })
}

export function lockMonth(year: number, month: number) {
  return api<{ lockedRecords: number }>('/attendance/lock', {
    method: 'POST',
    body: { year, month },
  })
}

export interface BulkBiometricRowResult {
  row: number
  success: boolean
  employeeId?: string
  errors?: string[]
}

export interface BulkBiometricUploadResult {
  totalRows: number
  successCount: number
  failureCount: number
  dryRun: boolean
  results: BulkBiometricRowResult[]
}

// Bypasses the shared api() helper (which always JSON-encodes the body) —
// this sends a real file as multipart form data, same pattern as the Shift
// module's bulkUploadWfoSchedule().
export async function bulkUploadBiometric(file: File, dryRun: boolean) {
  const token = localStorage.getItem('accessToken')
  const form = new FormData()
  form.append('file', file)
  const res = await fetch(`${API_URL}/attendance/import/upload?dryRun=${dryRun}`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form,
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({ message: res.statusText }))
    throw new ApiError(body.message ?? 'Bulk upload failed', res.status)
  }
  return res.json() as Promise<BulkBiometricUploadResult>
}

export async function downloadBiometricTemplate() {
  const token = localStorage.getItem('accessToken')
  const res = await fetch(`${API_URL}/attendance/import/template`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
  if (!res.ok) throw new ApiError('Failed to download template', res.status)

  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = 'biometric-attendance-template.xlsx'
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}
