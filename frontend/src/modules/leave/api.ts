import { api } from '@/lib/api'

export interface LeaveType {
  id: string
  name: string
  code: string | null
  accrualFrequency: 'MONTHLY' | 'QUARTERLY' | 'ANNUAL'
  accrualRate: number
  maxCarryForward: number
  isEncashable: boolean
  allowsNegativeBalance: boolean
}

export interface LeaveBalanceEntry {
  leaveType: LeaveType
  balance: { openingBalance: number; accrued: number; used: number; carriedForward: number }
  available: number
}

export interface LeaveApplication {
  id: string
  employeeId: string
  leaveTypeId: string
  leaveType?: LeaveType
  employee?: { firstName: string; lastName: string }
  startDate: string
  endDate: string
  daysCount: number
  reason: string | null
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED'
  createdAt: string
}

// Phase 6E: daysCount === 0.5 unambiguously means a half-day application —
// only a HALF_DAY request can ever produce a non-integer daysCount, so no
// new field/column is needed to represent it for display.
export function isHalfDayApplication(a: LeaveApplication): boolean {
  return a.daysCount === 0.5
}

export function listLeaveTypes() {
  return api<LeaveType[]>('/leave/types')
}

export function createLeaveType(data: Partial<LeaveType>) {
  return api<LeaveType>('/leave/policy', { method: 'POST', body: data })
}

export function getBalances(employeeId: string, year?: number) {
  return api<LeaveBalanceEntry[]>(`/leave/balance/${employeeId}`, {
    params: year ? { year: String(year) } : undefined,
  })
}

export function applyLeave(data: {
  leaveTypeId: string
  startDate: string
  endDate: string
  reason?: string
  duration?: 'FULL_DAY' | 'HALF_DAY'
}) {
  return api<LeaveApplication>('/leave/apply', { method: 'POST', body: data })
}

export function decideLeave(id: string, approve: boolean, comment?: string) {
  return api<{ status: string }>(`/leave/${id}/decision`, {
    method: 'POST',
    body: { approve, comment },
  })
}

export function cancelLeave(id: string) {
  return api<{ status: string }>(`/leave/${id}/cancel`, { method: 'POST' })
}

export function myApplications() {
  return api<LeaveApplication[]>('/leave/my-applications')
}

export function pendingApprovals() {
  return api<LeaveApplication[]>('/leave/pending-approvals')
}

// Phase 6A: company-wide pending list — SUPER_ADMIN only, backend-enforced.
export function listPendingRequests() {
  return api<LeaveApplication[]>('/leave/pending-requests')
}

// Phase 6B: Employee Profile → Leave history for an arbitrary employee.
// Backend enforces scope (self / privileged / direct manager).
export function getApplicationsForEmployee(employeeId: string) {
  return api<LeaveApplication[]>(`/leave/applications/${employeeId}`)
}

export function teamCalendar(from: string, to: string) {
  return api<LeaveApplication[]>('/leave/team-calendar', { params: { from, to } })
}
