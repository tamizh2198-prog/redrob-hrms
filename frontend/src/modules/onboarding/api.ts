import { api } from '@/lib/api'

export type ChecklistStatus = 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED'
export type ChecklistTaskStatus = 'PENDING' | 'COMPLETED'
export type ChecklistOwnerRole = 'HR' | 'IT' | 'MANAGER' | 'NEW_HIRE'

export interface ChecklistTask {
  id: string
  checklistId: string
  ownerRole: ChecklistOwnerRole
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
}

export interface ChecklistWithEmployee extends OnboardingChecklist {
  employee: { id: string; firstName: string; lastName: string; employeeCode: string }
}

export interface OnboardingTemplate {
  id: string
  name: string
  departmentId: string | null
  version: number
  isActive: boolean
  taskTemplates: Array<{
    id: string
    ownerRole: ChecklistOwnerRole
    description: string
    dueOffsetDays: number
  }>
}

export function createTemplate(data: {
  name: string
  departmentId?: string
  tasks: Array<{ ownerRole: ChecklistOwnerRole; description: string; dueOffsetDays?: number }>
}) {
  return api<OnboardingTemplate>('/onboarding/templates', { method: 'POST', body: data })
}

export function listTemplates() {
  return api<OnboardingTemplate[]>('/onboarding/templates')
}

export function listActiveChecklists() {
  return api<ChecklistWithEmployee[]>('/onboarding/checklists')
}

export function initChecklist(employeeId: string) {
  return api<OnboardingChecklist>(`/onboarding/${employeeId}/init`, { method: 'POST' })
}

export function getProgress(employeeId: string) {
  return api<OnboardingProgress>(`/onboarding/${employeeId}/progress`)
}

export function activateEmployee(employeeId: string) {
  return api<{ status: string }>(`/onboarding/${employeeId}/activate`, { method: 'POST' })
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
