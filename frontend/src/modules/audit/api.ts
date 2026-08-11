import { api, ApiError } from '@/lib/api'

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3001/api/v1'

export interface AuditLogEntry {
  id: string
  companyId: string
  actorId: string | null
  actorRole: string | null
  method: string
  path: string
  module: string
  statusCode: number | null
  requestBody: Record<string, unknown> | null
  responseBody: Record<string, unknown> | null
  createdAt: string
}

export interface AuditLogListResponse {
  items: AuditLogEntry[]
  total: number
  page: number
  pageSize: number
}

export interface AuditLogFilters {
  module?: string
  actorId?: string
  dateFrom?: string
  dateTo?: string
  page?: number
  pageSize?: number
}

export function listAuditLogs(filters: AuditLogFilters = {}) {
  return api<AuditLogListResponse>('/audit-logs', {
    params: {
      module: filters.module,
      actorId: filters.actorId,
      dateFrom: filters.dateFrom,
      dateTo: filters.dateTo,
      page: filters.page?.toString(),
      pageSize: filters.pageSize?.toString(),
    },
  })
}

// Bypasses the shared `api()` helper (which always JSON-parses the body) —
// the export comes back as a file, so this needs the raw Response to read a
// Blob, same approach as Analytics' exportReport().
export async function exportAuditLogs(filters: AuditLogFilters = {}) {
  const url = new URL(`${API_URL}/audit-logs/export`)
  const params = {
    module: filters.module,
    actorId: filters.actorId,
    dateFrom: filters.dateFrom,
    dateTo: filters.dateTo,
  }
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) url.searchParams.set(key, value)
  }

  const token = localStorage.getItem('accessToken')
  const res = await fetch(url.toString(), {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({ message: res.statusText }))
    throw new ApiError(body.message ?? 'Export failed', res.status)
  }
  const blob = await res.blob()
  const disposition = res.headers.get('Content-Disposition') ?? ''
  const match = /filename="([^"]+)"/.exec(disposition)
  const filename = match?.[1] ?? 'audit-logs.csv'

  const objectUrl = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = objectUrl
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(objectUrl)
}
