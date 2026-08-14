import { api } from '@/lib/api'

export type RequisitionStatus =
  | 'PENDING_APPROVAL'
  | 'APPROVED'
  | 'PUBLISHED'
  | 'ON_HOLD'
  | 'FILLED'
  | 'CLOSED'

export type CandidateStage = 'APPLIED' | 'SCREENING' | 'INTERVIEW' | 'OFFER' | 'HIRED' | 'REJECTED'

export type OfferStatus = 'DRAFT' | 'PENDING_APPROVAL' | 'SENT' | 'ACCEPTED' | 'DECLINED' | 'EXPIRED'

export interface JobRequisition {
  id: string
  title: string
  departmentId: string
  hiringManagerId: string
  headcount: number
  status: RequisitionStatus
  approvedBy: string | null
  approvedAt: string | null
  budgetCtc: number | null
  createdAt: string
}

export interface Candidate {
  id: string
  requisitionId: string
  name: string
  email: string
  phone: string | null
  resumeRef: string | null
  source: string | null
  currentStage: CandidateStage
  duplicateOfId: string | null
  appliedAt: string
  // Most recent first — lets the pipeline view show the full offer flow
  // (approvals, sent/accepted dates, the employee it created) without a
  // separate fetch.
  offers: Offer[]
}

export interface InterviewRound {
  id: string
  candidateId: string
  interviewerId: string
  scheduledAt: string
  recommendation: string | null
  completedAt: string | null
}

export interface Offer {
  id: string
  candidateId: string
  status: OfferStatus
  hiringManagerApprovedAt: string | null
  hrApprovedAt: string | null
  sentAt: string | null
  acceptedAt: string | null
  createdEmployeeId: string | null
}

export interface PipelineAnalytics {
  totalCandidates: number
  byStage: Record<CandidateStage, number>
  timeToFillDays: number | null
}

export interface OfferTemplate {
  id: string
  name: string
  subject: string
  body: string
  isDefault: boolean
  createdAt: string
}

export function createRequisition(data: {
  title: string
  departmentId: string
  hiringManagerId: string
  headcount?: number
  budgetCtc?: number
}) {
  return api<JobRequisition>('/ats/requisitions', { method: 'POST', body: data })
}

export function listRequisitions() {
  return api<JobRequisition[]>('/ats/requisitions')
}

export function getRequisitionAnalytics(id: string) {
  return api<PipelineAnalytics>(`/ats/requisitions/${id}/analytics`)
}

export function approveRequisition(id: string) {
  return api<JobRequisition>(`/ats/requisitions/${id}/approve`, { method: 'POST' })
}

export function publishRequisition(id: string) {
  return api<JobRequisition>(`/ats/requisitions/${id}/publish`, { method: 'POST' })
}

export function createCandidate(data: {
  requisitionId: string
  name: string
  email: string
  phone?: string
  resumeRef?: string
  source?: string
}) {
  return api<Candidate>('/ats/candidates', { method: 'POST', body: data })
}

export function listCandidates(requisitionId?: string) {
  return api<Candidate[]>('/ats/candidates', { params: { requisitionId } })
}

export function moveCandidateStage(id: string, stage: CandidateStage) {
  return api<Candidate>(`/ats/candidates/${id}/stage`, { method: 'PATCH', body: { stage } })
}

export function scheduleInterview(candidateId: string, data: { interviewerId: string; scheduledAt: string }) {
  return api<InterviewRound>(`/ats/candidates/${candidateId}/interviews`, {
    method: 'POST',
    body: data,
  })
}

export function submitScorecard(
  roundId: string,
  data: { scorecard: Record<string, unknown>; recommendation?: string },
) {
  return api<InterviewRound>(`/ats/interviews/${roundId}/scorecard`, { method: 'POST', body: data })
}

export function createOffer(data: { candidateId: string; ctcBreakup: Record<string, unknown> }) {
  return api<Offer>('/ats/offers', { method: 'POST', body: data })
}

export function createOfferTemplate(data: {
  name: string
  subject: string
  body: string
  isDefault?: boolean
}) {
  return api<OfferTemplate>('/ats/offer-templates', { method: 'POST', body: data })
}

export function listOfferTemplates() {
  return api<OfferTemplate[]>('/ats/offer-templates')
}

export function updateOfferTemplate(
  id: string,
  data: Partial<{ name: string; subject: string; body: string; isDefault: boolean }>,
) {
  return api<OfferTemplate>(`/ats/offer-templates/${id}`, { method: 'PATCH', body: data })
}

export function deleteOfferTemplate(id: string) {
  return api<{ deleted: boolean }>(`/ats/offer-templates/${id}`, { method: 'DELETE' })
}

export function approveOffer(id: string) {
  return api<Offer>(`/ats/offers/${id}/approve`, { method: 'POST' })
}

export function sendOffer(id: string, templateId?: string) {
  return api<{ offer: Offer; responseLink: string }>(`/ats/offers/${id}/send`, {
    method: 'POST',
    body: { templateId },
  })
}

export function getOfferPortal(token: string) {
  return api<{
    status: OfferStatus
    ctcBreakup: Record<string, unknown>
    candidateName: string
    requisitionTitle: string
  }>('/ats/offers/portal', { params: { token } })
}

export function respondOffer(token: string, decision: 'ACCEPT' | 'DECLINE') {
  return api<{ status: string; employeeId?: string; preboardingLink?: string }>('/ats/offers/respond', {
    method: 'POST',
    body: { token, decision },
  })
}
