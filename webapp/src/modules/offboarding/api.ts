import { api, ApiError } from '@/lib/api'

export type ResignationStatus = 'SUBMITTED' | 'REJECTED' | 'CLEARANCE_IN_PROGRESS' | 'CLEARED' | 'SETTLED' | 'ARCHIVED'
export type ClearanceItemCategory = 'LEAD_VERIFICATION' | 'EMPLOYEE_DECLARATION'
export type ClearanceStatus = 'PENDING' | 'SIGNED_OFF'
export type SettlementStatus = 'DRAFT' | 'PENDING_APPROVAL' | 'APPROVED' | 'PAID'
export type ResignationLetterStatus = 'NOT_READY' | 'PENDING_VERIFICATION' | 'SENT'

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

// Mirrors RelievingLetterData server-side — every field the letter template
// prints. employeeCode is excluded from the editable fields below (see
// updateRelievingLetter): it's the one immutable identifier on the letter.
export interface RelievingLetterData {
  employeeName: string
  employeeCode: string
  dateOfJoining: string
  lastWorkingDay: string
  designation: string
  location: string
  department: string
  gender: 'MALE' | 'FEMALE' | 'OTHER' | 'PREFER_NOT_TO_SAY' | null
  generatedDate: string
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
  letterStatus: ResignationLetterStatus
  // Auto-generated once the clearance checklist is fully signed off; null
  // until then. Editable by Super Admin (see updateRelievingLetter) while
  // still PENDING_VERIFICATION.
  letterDataSnapshot: RelievingLetterData | null
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

export function submitResignation(data: { employeeId?: string; noticePeriodDays: number; personalEmail: string }) {
  return api<Resignation>('/offboarding/resign', { method: 'POST', body: data })
}

export function acceptResignation(id: string) {
  return api<Resignation>(`/offboarding/${id}/accept`, { method: 'POST' })
}

export function rejectResignation(id: string, reason: string) {
  return api<Resignation>(`/offboarding/${id}/reject`, { method: 'POST', body: { reason } })
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

// Opens the PDF in a new tab rather than force-downloading it — same
// authenticated-blob pattern as downloadActiveEmployees() in the employee
// module, since a plain <a href> can't carry the Bearer token.
export async function previewRelievingLetter(id: string) {
  const res = await fetch(`/api/v1/offboarding/${id}/letters/preview`, { credentials: 'same-origin' })
  if (!res.ok) {
    const body = await res.json().catch(() => ({ message: 'Failed to load the letter preview' }))
    throw new ApiError(body.message, res.status)
  }
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  window.open(url, '_blank')
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

export function sendRelievingLetter(id: string, closingRemarks?: string) {
  return api<Resignation>(`/offboarding/${id}/letters/send`, {
    method: 'POST',
    body: { closingRemarks },
  })
}

// Super Admin-only correction pass on the auto-generated letter fields,
// before sending — every field except employeeCode is editable. Only
// accepted while the letter is still PENDING_VERIFICATION.
export function updateRelievingLetter(id: string, data: Partial<Omit<RelievingLetterData, 'employeeCode' | 'gender'>>) {
  return api<RelievingLetterData>(`/offboarding/${id}/letters`, { method: 'PATCH', body: data })
}
