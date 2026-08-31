import { api } from '@/lib/api'

export type ResignationStatus = 'SUBMITTED' | 'CLEARANCE_IN_PROGRESS' | 'CLEARED' | 'SETTLED' | 'ARCHIVED'
export type ClearanceItemCategory = 'LEAD_VERIFICATION' | 'EMPLOYEE_DECLARATION'
export type ClearanceStatus = 'PENDING' | 'SIGNED_OFF'
export type SettlementStatus = 'DRAFT' | 'PENDING_APPROVAL' | 'APPROVED' | 'PAID'

export interface ClearanceItem {
  id: string
  resignationId: string
  key: string
  label: string
  category: ClearanceItemCategory
  status: ClearanceStatus
  signedOffBy: string | null
  signedOffAt: string | null
  remarks: string | null
}

export interface LwdAdjustment {
  id: string
  resignationId: string
  previousDate: string
  newDate: string
  reason: string
  adjustedBy: string
  adjustedAt: string
}

export interface Resignation {
  id: string
  employeeId: string
  // Only present on the Super Admin/HR Admin "All Resignations" list —
  // listResignations() includes it, but per-resignation lookups don't need it.
  employee?: { firstName: string; lastName: string; employeeCode: string }
  submittedDate: string
  noticePeriodDays: number
  lastWorkingDay: string
  status: ResignationStatus
  rehireEligible: boolean
  relievingLetterRef: string | null
  experienceLetterRef: string | null
  lettersGeneratedAt: string | null
  closingRemarks: string | null
  certificateReleasedBy: string | null
  clearanceItems?: ClearanceItem[]
  lwdAdjustments?: LwdAdjustment[]
}

export interface FinalSettlement {
  id: string
  resignationId: string
  employeeId: string
  pendingSalary: number
  leaveEncashment: number
  noticeRecovery: number
  assetRecovery: number
  netPayable: number
  status: SettlementStatus
  computedAt: string | null
  approvedBy: string | null
  approvedAt: string | null
  paidAt: string | null
}

export function submitResignation(data: { employeeId?: string; noticePeriodDays: number }) {
  return api<Resignation>('/offboarding/resign', { method: 'POST', body: data })
}

export function listResignations() {
  return api<Resignation[]>('/offboarding')
}

export function getResignation(id: string) {
  return api<Resignation>(`/offboarding/${id}`)
}

export function adjustLwd(id: string, data: { newDate: string; reason: string }) {
  return api<LwdAdjustment>(`/offboarding/${id}/adjust-lwd`, { method: 'POST', body: data })
}

export function getClearanceStatus(id: string) {
  return api<ClearanceItem[]>(`/offboarding/${id}/clearance`)
}

export function signoffClearance(itemId: string, remarks?: string) {
  return api<ClearanceItem>(`/offboarding/clearance/${itemId}/signoff`, {
    method: 'POST',
    body: { remarks },
  })
}

export function submitExitInterview(id: string, responses: Record<string, unknown>) {
  return api<{ id: string }>(`/offboarding/${id}/exit-interview`, { method: 'POST', body: { responses } })
}

export function computeSettlement(id: string, perDayPayRate: number, pendingSalary?: number) {
  return api<FinalSettlement>(`/offboarding/${id}/settlement`, {
    params: {
      perDayPayRate: perDayPayRate.toString(),
      pendingSalary: pendingSalary?.toString(),
    },
  })
}

export function approveSettlement(id: string) {
  return api<FinalSettlement>(`/offboarding/${id}/settlement/approve`, { method: 'POST' })
}

export function markSettlementPaid(id: string, rehireEligible?: boolean) {
  return api<{ status: string }>(`/offboarding/${id}/settlement/mark-paid`, {
    method: 'POST',
    body: { rehireEligible },
  })
}

export function generateLetters(id: string, closingRemarks?: string) {
  return api<Resignation>(`/offboarding/${id}/generate-letters`, {
    method: 'POST',
    body: { closingRemarks },
  })
}
