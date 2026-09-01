import { api } from '@/lib/api'

export type TicketCategory =
  | 'PAYROLL_QUERY'
  | 'LEAVE_ATTENDANCE_ISSUE'
  | 'IT_SUPPORT'
  | 'ADMIN_FACILITIES'
  | 'GENERAL_HR'

export type TicketPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT'

export type TicketStatus = 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED' | 'REOPENED'

export interface Ticket {
  id: string
  employeeId: string
  category: TicketCategory
  priority: TicketPriority
  subject: string
  description: string
  status: TicketStatus
  assignedAgentId: string | null
  slaDueAt: string | null
  slaWarningNotifiedAt: string | null
  slaBreachedAt: string | null
  resolutionNote: string | null
  resolvedAt: string | null
  closedAt: string | null
  reopenedAt: string | null
  csatRating: number | null
  createdAt: string
  updatedAt: string
}

export interface TicketMessage {
  id: string
  ticketId: string
  senderId: string
  body: string
  isInternalNote: boolean
  attachmentRef: string | null
  createdAt: string
}

export interface TicketDetail extends Ticket {
  messages: TicketMessage[]
}

export interface TicketListResponse {
  items: Ticket[]
  total: number
  page: number
  pageSize: number
}

export interface FaqEntry {
  id: string
  category: TicketCategory | null
  question: string
  answer: string
}

export interface TicketSlaPolicy {
  id: string
  category: TicketCategory
  priority: TicketPriority
  slaHours: number
  agentId: string | null
}

export interface DashboardSummary {
  volumeByCategory: Record<string, number>
  volumeByAgent: Record<string, number>
  volumeByMonth: Record<string, number>
  slaCompliancePercent: number
  topCategories: Array<{ category: string; count: number }>
}

export function createTicket(data: {
  category: TicketCategory
  priority?: TicketPriority
  subject: string
  description: string
}) {
  return api<Ticket>('/helpdesk/tickets', { method: 'POST', body: data })
}

export function listTickets(params: {
  status?: TicketStatus
  category?: TicketCategory
  priority?: TicketPriority
  assignedAgentId?: string
  page?: number
  pageSize?: number
}) {
  return api<TicketListResponse>('/helpdesk/tickets', {
    params: {
      status: params.status,
      category: params.category,
      priority: params.priority,
      assignedAgentId: params.assignedAgentId,
      page: params.page?.toString(),
      pageSize: params.pageSize?.toString(),
    },
  })
}

export function getTicket(id: string) {
  return api<TicketDetail>(`/helpdesk/tickets/${id}`)
}

export function addMessage(id: string, data: { body: string; isInternalNote?: boolean }) {
  return api<TicketMessage>(`/helpdesk/tickets/${id}/message`, { method: 'POST', body: data })
}

export function assignTicket(id: string, agentId: string) {
  return api<Ticket>(`/helpdesk/tickets/${id}/assign`, { method: 'POST', body: { agentId } })
}

export function updateTicketStatus(
  id: string,
  data: { status: TicketStatus; resolutionNote?: string; csatRating?: number },
) {
  return api<Ticket>(`/helpdesk/tickets/${id}/status`, { method: 'PATCH', body: data })
}

export function searchFaq(params: { q?: string; category?: TicketCategory }) {
  return api<FaqEntry[]>('/helpdesk/faq', { params })
}

export function createFaq(data: { category?: TicketCategory; question: string; answer: string }) {
  return api<FaqEntry>('/helpdesk/faq', { method: 'POST', body: data })
}

export function listSlaPolicies() {
  return api<TicketSlaPolicy[]>('/helpdesk/sla-policies')
}

export function upsertSlaPolicy(data: {
  category: TicketCategory
  priority: TicketPriority
  slaHours: number
  agentId?: string
}) {
  return api<TicketSlaPolicy>('/helpdesk/sla-policies', { method: 'POST', body: data })
}

export function getDashboardSummary() {
  return api<DashboardSummary>('/helpdesk/dashboard')
}
