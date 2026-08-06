import { api } from '@/lib/api'

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
  shift: Shift | null
}

export interface ShiftSwapRequest {
  id: string
  requesterId: string
  counterpartId: string
  requester?: { firstName: string; lastName: string }
  counterpart?: { firstName: string; lastName: string }
  date: string
  status: 'PENDING' | 'APPROVED' | 'REJECTED'
  approverId: string | null
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
}) {
  return api<{ successCount: number; failureCount: number; results: unknown[] }>(
    '/roster/assign',
    { method: 'POST', body: data },
  )
}

export function getRoster(employeeId: string, from: string, to: string) {
  return api<RosterEntry[]>(`/roster/${employeeId}`, { params: { from, to } })
}

export function requestSwap(data: { counterpartId: string; date: string; override?: boolean }) {
  return api<ShiftSwapRequest>('/roster/swap', { method: 'POST', body: data })
}

export function listSwaps(params: { employeeId?: string; approverId?: string }) {
  return api<ShiftSwapRequest[]>('/roster/swap', { params })
}

export function decideSwap(id: string, approve: boolean) {
  return api<{ status: string }>(`/roster/swap/${id}/decision`, {
    method: 'POST',
    body: { approve },
  })
}
