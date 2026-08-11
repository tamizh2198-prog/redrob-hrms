import { api } from '@/lib/api'

export type NotificationChannel = 'IN_APP' | 'EMAIL' | 'SLACK' | 'SMS'

export interface NotificationItem {
  id: string
  template: string
  title: string
  body: string
  data: Record<string, unknown> | null
  readAt: string | null
  createdAt: string
}

export interface InboxResponse {
  items: NotificationItem[]
  total: number
  page: number
  pageSize: number
  unreadCount: number
}

export interface NotificationPreferenceRow {
  eventCategory: string
  channelsEnabled: NotificationChannel[]
}

export interface DeliveryReport {
  volumeByTemplate: Record<string, number>
  byChannel: Record<string, { sent: number; failed: number }>
  inAppCount: number
}

export function listInbox(params: { unreadOnly?: boolean; page?: number; pageSize?: number } = {}) {
  return api<InboxResponse>('/notifications/inbox', {
    params: {
      unreadOnly: params.unreadOnly ? 'true' : undefined,
      page: params.page?.toString(),
      pageSize: params.pageSize?.toString(),
    },
  })
}

export function markRead(id: string) {
  return api<NotificationItem>(`/notifications/${id}/read`, { method: 'PATCH' })
}

export function markAllRead() {
  return api<{ success: boolean }>('/notifications/read-all', { method: 'PATCH' })
}

export function getPreferences() {
  return api<NotificationPreferenceRow[]>('/notifications/preferences')
}

export function updatePreferences(data: {
  eventCategory: string
  channelsEnabled: NotificationChannel[]
}) {
  return api<NotificationPreferenceRow>('/notifications/preferences', {
    method: 'PATCH',
    body: data,
  })
}

export function getDeliveryReport() {
  return api<DeliveryReport>('/notifications/logs')
}
