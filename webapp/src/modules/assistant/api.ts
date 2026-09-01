import { api } from '@/lib/api'

export type AssistantMessageRole = 'USER' | 'ASSISTANT'

export interface GroundedSource {
  docId: string
  title: string
  excerpt: string
}

export interface ProposedAction {
  type: string
  input: Record<string, unknown>
}

export interface AssistantMessage {
  id: string
  conversationId: string
  role: AssistantMessageRole
  message: string
  groundedSources: GroundedSource[] | null
  proposedAction: ProposedAction | null
  actionTaken: Record<string, unknown> | null
  createdAt: string
}

export function sendMessage(data: { conversationId?: string; message: string }) {
  return api<AssistantMessage>('/assistant/message', { method: 'POST', body: data })
}

export function confirmAction(messageId: string) {
  return api<AssistantMessage>('/assistant/action/confirm', { method: 'POST', body: { messageId } })
}

export function listConversationMessages(conversationId: string) {
  return api<AssistantMessage[]>(`/assistant/conversations/${conversationId}/messages`)
}

export function uploadPolicyDocument(data: { title: string; content: string }) {
  return api<{ id: string }>('/assistant/policy/upload', { method: 'POST', body: data })
}
