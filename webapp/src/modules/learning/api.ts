import { api } from '@/lib/api'

export type LearningRequestStatus =
  | 'PENDING_MANAGER'
  | 'PENDING_SUPER_ADMIN'
  | 'APPROVED'
  | 'REJECTED'
  | 'COMPLETED'
  | 'REIMBURSED'

export interface LearningRequest {
  id: string
  employeeId: string
  employee?: { firstName: string; lastName: string; employeeCode: string }
  courseName: string
  duration: string
  purpose: string
  organizationalImpact: string
  cost: number
  timeCommitment: string
  requestYear: number
  status: LearningRequestStatus
  approverId: string | null
  approver?: { firstName: string; lastName: string } | null
  managerApproverId: string | null
  managerApprover?: { firstName: string; lastName: string } | null
  managerDecidedAt: string | null
  finalApproverId: string | null
  finalApprover?: { firstName: string; lastName: string } | null
  decidedAt: string | null
  certificateRef: string | null
  completedAt: string | null
  reimbursedBy: string | null
  reimbursedAt: string | null
  createdAt: string
}

export interface SpendLimit {
  employeeId: string
  ctcLpa: number
  requestYear: number
  annualLimit: number
  used: number
  remaining: number
}

export interface SpendLimitWithEmployee {
  employeeId: string
  ctcLpa: number | null
  requestYear: number
  annualLimit: number | null
  used: number
  remaining: number | null
  firstName: string
  lastName: string
  employeeCode: string
}

export function getMySpendLimit() {
  return api<SpendLimit>('/learning/spend-limit/mine')
}

export function listAllSpendLimits() {
  return api<SpendLimitWithEmployee[]>('/learning/spend-limit')
}

export function submitLearningRequest(data: {
  courseName: string
  duration: string
  purpose: string
  organizationalImpact: string
  cost: number
  timeCommitment: string
}) {
  return api<LearningRequest>('/learning/requests', { method: 'POST', body: data })
}

export function myLearningRequests() {
  return api<LearningRequest[]>('/learning/requests/mine')
}

export function pendingLearningRequestsForMe() {
  return api<LearningRequest[]>('/learning/requests/pending-for-me')
}

export function pendingLearningManagerStageForVisibility() {
  return api<LearningRequest[]>('/learning/requests/pending-manager-stage')
}

export function pendingLearningFinalApproval() {
  return api<LearningRequest[]>('/learning/requests/pending-final-approval')
}

export function decideLearningRequest(id: string, approve: boolean, comment?: string) {
  return api<{ status: string }>(`/learning/requests/${id}/decision`, {
    method: 'POST',
    body: { approve, comment },
  })
}

export function submitLearningCertificate(id: string, certificateRef: string) {
  return api<LearningRequest>(`/learning/requests/${id}/certificate`, {
    method: 'POST',
    body: { certificateRef },
  })
}

export function markLearningReimbursed(id: string) {
  return api<LearningRequest>(`/learning/requests/${id}/reimburse`, { method: 'POST' })
}

export function listAllLearningRequests(status?: LearningRequestStatus) {
  return api<LearningRequest[]>('/learning/requests', { params: status ? { status } : undefined })
}
