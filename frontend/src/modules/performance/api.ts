import { api } from '@/lib/api'

export type ReviewCycleStatus = 'DRAFT' | 'OPEN' | 'CALIBRATION' | 'CLOSED'
export type ReviewCycleType = 'MONTHLY' | 'QUARTERLY' | 'YEARLY'
export type ReviewStatus = 'NOT_STARTED' | 'IN_PROGRESS' | 'READY_FOR_CALIBRATION' | 'FINALIZED'

export interface ReviewCycle {
  id: string
  companyId: string
  name: string
  cycleType: ReviewCycleType
  periodStart: string
  periodEnd: string
  status: ReviewCycleStatus
  closedBy: string | null
  closedAt: string | null
  createdAt: string
}

export interface Goal {
  id: string
  employeeId: string
  cycleId: string
  parentGoalId: string | null
  title: string
  target: number | null
  actual: number
  weightage: number
  createdAt: string
}

export interface ReviewCorrection {
  id: string
  reviewId: string
  previousRating: number | null
  newRating: number
  reason: string
  correctedBy: string
  correctedAt: string
}

export interface Review {
  id: string
  cycleId: string
  employeeId: string
  selfAssessmentJson: Record<string, unknown> | null
  managerAssessmentJson: Record<string, unknown> | null
  finalRating: number | null
  status: ReviewStatus
  version: number
  finalizedBy: string | null
  finalizedAt: string | null
  corrections?: ReviewCorrection[]
}

export interface CalibrationBucket {
  count: number
  average: number
}

export interface CalibrationView {
  totalRated: number
  byDepartment: Record<string, CalibrationBucket>
  byManager: Record<string, CalibrationBucket>
}

export function openReviewCycle(data: {
  companyId?: string
  name: string
  cycleType?: ReviewCycleType
  periodStart: string
  periodEnd?: string
}) {
  return api<ReviewCycle>('/performance/reviews/cycle', { method: 'POST', body: data })
}

export function listReviewCycles() {
  return api<ReviewCycle[]>('/performance/reviews/cycles')
}

export function closeReviewCycle(id: string) {
  return api<{ status: string; reviewsFinalized: number }>(`/performance/reviews/cycle/${id}/close`, {
    method: 'POST',
  })
}

export function getCalibrationView(cycleId: string) {
  return api<CalibrationView>(`/performance/reviews/cycle/${cycleId}/calibration`)
}

export function createGoal(data: {
  employeeId?: string
  cycleId: string
  parentGoalId?: string
  title: string
  target?: number
  weightage: number
}) {
  return api<Goal>('/performance/goals', { method: 'POST', body: data })
}

export function listGoals(employeeId: string, cycleId?: string) {
  return api<Goal[]>('/performance/goals', { params: { employeeId, cycleId } })
}

export function updateGoalProgress(id: string, actual: number) {
  return api<Goal>(`/performance/goals/${id}/progress`, { method: 'PATCH', body: { actual } })
}

export function submitSelfAssessment(data: { cycleId: string; assessment: Record<string, unknown> }) {
  return api<Review>('/performance/reviews/self-assessment', { method: 'POST', body: data })
}

export function submitManagerAssessment(data: {
  cycleId: string
  employeeId: string
  assessment: Record<string, unknown>
  rating: number
}) {
  return api<Review>('/performance/reviews/manager-assessment', { method: 'POST', body: data })
}

export function correctRating(reviewId: string, data: { newRating: number; reason: string }) {
  return api<Review>(`/performance/reviews/${reviewId}/correct-rating`, { method: 'POST', body: data })
}

export function getReview(cycleId: string, employeeId: string) {
  return api<Review | null>(`/performance/reviews/${cycleId}/${employeeId}`)
}

export type PerformanceGrade = 'FEE' | 'EE' | 'ME' | 'PME' | 'DNME'
export type EvaluationAuditStatus = 'PENDING_AUDIT' | 'APPROVED' | 'SENT_BACK'

// kpiScore/justification/submittedBy/auditNotes are omitted by the backend
// when the viewer is the evaluation's own subject — see PerformanceService's
// confidentiality rule. Optional here so both shapes type-check.
export interface MonthlyEvaluation {
  id: string
  employeeId: string
  period: string
  grade: PerformanceGrade
  auditStatus: EvaluationAuditStatus
  createdAt: string
  kpiScore?: number
  justification?: string
  submittedBy?: string
  submittedAt?: string
  auditedBy?: string | null
  auditedAt?: string | null
  auditNotes?: string | null
}

export function submitMonthlyEvaluation(data: {
  employeeId: string
  period: string
  kpiScore: number
  justification: string
}) {
  return api<MonthlyEvaluation>('/performance/evaluations', { method: 'POST', body: data })
}

export function listMonthlyEvaluations(employeeId: string) {
  return api<MonthlyEvaluation[]>('/performance/evaluations', { params: { employeeId } })
}

export function auditMonthlyEvaluation(id: string, data: { approve: boolean; auditNotes?: string }) {
  return api<MonthlyEvaluation>(`/performance/evaluations/${id}/audit`, { method: 'POST', body: data })
}
