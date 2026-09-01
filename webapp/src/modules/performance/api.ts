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

export function getReview(cycleId: string, employeeId: string) {
  return api<Review | null>(`/performance/reviews/${cycleId}/${employeeId}`)
}

export type PerformanceGrade = 'FEE' | 'EE' | 'ME' | 'PME' | 'DNME'
export type EvaluationAuditStatus = 'PENDING_AUDIT' | 'APPROVED' | 'SENT_BACK'

// kpiScore/justification/submittedBy/auditNotes are omitted by the backend
// when the viewer is the evaluation's own subject — see the performance
// service's confidentiality rule. Optional here so both shapes type-check.
// kpiScore/kpiPercent/grade are additionally null on the subject's own view
// until auditStatus is APPROVED *and* the release date (3rd of the month
// after the period) has passed — releaseDate is always present so the UI
// can say when it'll show up.
export interface MonthlyEvaluation {
  id: string
  employeeId: string
  period: string
  grade: PerformanceGrade | null
  auditStatus: EvaluationAuditStatus
  releaseDate?: string
  createdAt: string
  kpiScore?: number | null
  // kpiScore on a 0-100 scale (kpiScore / 10, rounded).
  kpiPercent?: number | null
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

// P&B effective January 2026, "3a. Member KPI Linked Rewards" — a quarter's
// payout, derived from that quarter's 3 approved monthly evaluations and the
// employee's CTC band. Never persisted; always computed fresh.
export interface QuarterlyKpiRewardMonth {
  period: string
  kpiScore: number | null
  kpiPercent: number | null
  auditStatus: EvaluationAuditStatus | null
}

export interface QuarterlyKpiReward {
  employeeId: string
  year: number
  quarter: number
  months: QuarterlyKpiRewardMonth[]
  avgKpiPercent: number | null
  ctcBandLabel: string | null
  yearlyLimit: number | null
  quarterlyLimit: number | null
  rewardAmount: number | null
  complete: boolean
  reason: string | null
}

export interface QuarterlyKpiRewardsResponse {
  employeeId: string
  year: number
  ctcLpa: number | null
  quarters: QuarterlyKpiReward[]
}

export function listQuarterlyKpiRewards(employeeId: string, year: number) {
  return api<QuarterlyKpiRewardsResponse>(`/performance/kpi-rewards/${employeeId}/${year}`)
}
