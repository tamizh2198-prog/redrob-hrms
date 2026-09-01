import { api } from '@/lib/api'

export type AnnouncementScope = 'ORGANIZATION' | 'DEPARTMENT' | 'LOCATION'
export type AnnouncementPriority = 'LOW' | 'MEDIUM' | 'HIGH'
export type RecognitionCategory = 'TEAMWORK' | 'INNOVATION' | 'CUSTOMER_FOCUS'

export interface Announcement {
  id: string
  companyId: string
  title: string
  body: string
  scope: AnnouncementScope
  departmentId: string | null
  locationId: string | null
  priority: AnnouncementPriority
  isPinned: boolean
  requiresAck: boolean
  createdBy: string
  createdAt: string
  myAck: { acknowledgedAt: string | null } | null
}

export interface AnnouncementCompliance {
  totalTargeted: number
  acknowledged: number
  pending: number
  compliancePercentage: number
}

export interface AnnouncementComplianceUser {
  employeeId: string
  employeeCode: string
  firstName: string
  lastName: string
  acknowledged: boolean
  acknowledgedAt: string | null
}

export interface Recognition {
  id: string
  senderId: string
  recipientId: string
  message: string
  category: RecognitionCategory
  departmentId: string | null
  createdAt: string
}

export function createAnnouncement(data: {
  title: string
  body: string
  scope: AnnouncementScope
  departmentId?: string
  locationId?: string
  priority?: AnnouncementPriority
  isPinned?: boolean
  requiresAck?: boolean
}) {
  return api<Announcement>('/announcements', { method: 'POST', body: data })
}

export function listAnnouncements() {
  return api<Announcement[]>('/announcements')
}

export function getAnnouncement(id: string) {
  return api<Announcement>(`/announcements/${id}`)
}

export function ackAnnouncement(id: string) {
  return api<{ id: string; acknowledgedAt: string }>(`/announcements/${id}/ack`, { method: 'POST' })
}

export function getAnnouncementCompliance(id: string) {
  return api<AnnouncementCompliance>(`/announcements/${id}/compliance`)
}

export function getAnnouncementComplianceUsers(id: string) {
  return api<AnnouncementComplianceUser[]>(`/announcements/${id}/compliance/users`)
}

export function createRecognition(data: {
  recipientId: string
  message: string
  category: RecognitionCategory
  departmentId?: string
}) {
  return api<Recognition>('/recognition', { method: 'POST', body: data })
}

export function listRecognitionFeed() {
  return api<Recognition[]>('/recognition/feed')
}
