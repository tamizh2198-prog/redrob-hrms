import { api } from '@/lib/api'

export type ApproverRuleType = 'MANAGER' | 'SKIP_MANAGER' | 'ROLE'

export interface ApproverRule {
  type: ApproverRuleType
  role?: string
}

export interface StepCondition {
  field: string
  operator: 'gt' | 'gte' | 'lt' | 'lte' | 'eq'
  value: number
}

export interface WorkflowStep {
  sequence: number
  approverRules: ApproverRule[]
  requireAll: boolean
  slaHours?: number
  escalationTargetRole?: string
  condition?: StepCondition
}

export interface WorkflowDefinition {
  id: string
  name: string
  module: string
  stepsJson: WorkflowStep[]
  createdAt: string
}

export interface UnifiedApprovalItem {
  source: string
  id: string
  summary: string
  requestedAt: string
}

export function listDefinitions() {
  return api<WorkflowDefinition[]>('/workflow/definitions')
}

export function createDefinition(data: { name: string; module: string; steps: WorkflowStep[] }) {
  return api<WorkflowDefinition>('/workflow/definitions', { method: 'POST', body: data })
}

export function createRequest(data: {
  workflowId: string
  sourceModule: string
  sourceRecordId: string
  context?: Record<string, unknown>
}) {
  return api('/workflow/requests', { method: 'POST', body: data })
}

export function myApprovals() {
  return api<UnifiedApprovalItem[]>('/workflow/my-approvals')
}

export function decide(requestId: string, data: { decision: 'APPROVED' | 'REJECTED'; comment?: string }) {
  return api(`/workflow/requests/${requestId}/decide`, { method: 'POST', body: data })
}
