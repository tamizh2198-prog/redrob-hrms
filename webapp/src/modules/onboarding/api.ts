import { api } from '@/lib/api'

export type ChecklistStatus = 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED'
export type ChecklistTaskStatus = 'PENDING' | 'COMPLETED'
export type ChecklistOwnerRole = 'HR' | 'IT' | 'MANAGER' | 'NEW_HIRE'
export type OnboardingPhase = 'PRE_BOARDING' | 'DAY_ONE' | 'WEEK_ONE' | 'FIRST_90_DAYS'
export type ProbationCheckpoint = 'DAY_30' | 'DAY_60' | 'DAY_90'

export const ONBOARDING_PHASES: OnboardingPhase[] = [
  'PRE_BOARDING',
  'DAY_ONE',
  'WEEK_ONE',
  'FIRST_90_DAYS',
]

export const ONBOARDING_PHASE_LABELS: Record<OnboardingPhase, string> = {
  PRE_BOARDING: 'Pre-boarding',
  DAY_ONE: 'Day 1',
  WEEK_ONE: 'Week 1',
  FIRST_90_DAYS: 'First 90 Days',
}

export interface ChecklistTask {
  id: string
  checklistId: string
  ownerRole: ChecklistOwnerRole
  phase: OnboardingPhase
  description: string
  dueDate: string | null
  status: ChecklistTaskStatus
  completedBy: string | null
  completedAt: string | null
}

export interface OnboardingChecklist {
  id: string
  employeeId: string
  templateId: string
  status: ChecklistStatus
  tasks: ChecklistTask[]
}

export interface OnboardingProgress {
  checklist: OnboardingChecklist
  completionPercent: number
  missingMandatoryFields: string[]
}

export interface ChecklistWithEmployee extends OnboardingChecklist {
  employee: { id: string; firstName: string; lastName: string; employeeCode: string }
  missingMandatoryFields: string[]
}

export const MANDATORY_FIELD_LABELS: Record<string, string> = {
  ID_PROOF: 'Photo ID Proof',
  EDUCATION_CERTIFICATE: 'Education Certificate',
  BANK_DETAILS: 'Bank Details',
  BACKGROUND_CHECK_CONSENT: 'Background Check Consent',
}

export interface OnboardingTemplate {
  id: string
  name: string
  departmentId: string | null
  version: number
  isActive: boolean
  isDefault: boolean
  taskTemplates: Array<{
    id: string
    ownerRole: ChecklistOwnerRole
    phase: OnboardingPhase
    description: string
    dueOffsetDays: number
  }>
}

export function createTemplate(data: {
  name: string
  departmentId?: string
  isDefault?: boolean
  tasks: Array<{
    ownerRole: ChecklistOwnerRole
    phase: OnboardingPhase
    description: string
    dueOffsetDays?: number
  }>
}) {
  return api<OnboardingTemplate>('/onboarding/templates', { method: 'POST', body: data })
}

export function listTemplates() {
  return api<OnboardingTemplate[]>('/onboarding/templates')
}

export function listActiveChecklists() {
  return api<ChecklistWithEmployee[]>('/onboarding/checklists')
}

export function initChecklist(employeeId: string, templateId?: string) {
  return api<OnboardingChecklist>(`/onboarding/${employeeId}/init`, {
    method: 'POST',
    body: templateId ? { templateId } : {},
  })
}

export function getProgress(employeeId: string) {
  return api<OnboardingProgress>(`/onboarding/${employeeId}/progress`)
}

export function activateEmployee(employeeId: string) {
  return api<{ status: string }>(`/onboarding/${employeeId}/activate`, { method: 'POST' })
}

export function resendPreboardingLink(employeeId: string) {
  return api<{ emailSent: boolean; preboardingUrl?: string }>(
    `/onboarding/${employeeId}/preboarding-link`,
    { method: 'POST' },
  )
}

export function completeTask(taskId: string) {
  return api<ChecklistTask>(`/onboarding/tasks/${taskId}/complete`, { method: 'POST' })
}

export function getPortalProgress(token: string) {
  return api<OnboardingProgress>('/onboarding/portal/progress', { params: { token } })
}

export function completeTaskViaPortal(taskId: string, token: string) {
  return api<ChecklistTask>(`/onboarding/portal/tasks/${taskId}/complete`, {
    method: 'POST',
    body: { token },
  })
}

export function submitPreboarding(token: string, fieldType: string, valueRef: string) {
  return api<{ id: string }>('/onboarding/preboard/submit', {
    method: 'POST',
    body: { token, fieldType, valueRef },
  })
}

export interface ProbationFeedback {
  id: string
  employeeId: string
  checkpoint: ProbationCheckpoint
  reminderSentAt: string | null
  submittedAt: string | null
  companyRating: number | null
  workCultureRating: number | null
  comments: string | null
}

export interface ProbationFeedbackWithEmployee extends ProbationFeedback {
  employee: { firstName: string; lastName: string; employeeCode: string }
}

export function getMyProbationFeedback() {
  return api<ProbationFeedback[]>('/onboarding/probation-feedback/mine')
}

export function submitProbationFeedback(
  id: string,
  data: { companyRating: number; workCultureRating: number; comments?: string },
) {
  return api<ProbationFeedback>(`/onboarding/probation-feedback/${id}/submit`, {
    method: 'POST',
    body: data,
  })
}

export function listProbationFeedback() {
  return api<ProbationFeedbackWithEmployee[]>('/onboarding/probation-feedback')
}
