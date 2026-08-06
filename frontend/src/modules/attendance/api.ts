import { api } from '@/lib/api'

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

export interface CalendarDay {
  date: string
  status: AttendanceStatus
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
