import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ApiError } from '@/lib/api'
import {
  listAuditLogs,
  exportAuditLogs,
  type AuditLogEntry,
  type AuditLogFilters,
} from '../api'

const PAGE_SIZE = 20

export function AuditPage() {
  const [items, setItems] = useState<AuditLogEntry[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)

  const [moduleFilter, setModuleFilter] = useState('')
  const [actorFilter, setActorFilter] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    refresh(1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function currentFilters(): AuditLogFilters {
    return {
      module: moduleFilter || undefined,
      actorId: actorFilter || undefined,
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
    }
  }

  function refresh(nextPage: number) {
    setLoading(true)
    setError(null)
    listAuditLogs({ ...currentFilters(), page: nextPage, pageSize: PAGE_SIZE })
      .then((r) => {
        setItems(r.items)
        setTotal(r.total)
        setPage(r.page)
      })
      .catch((err) => {
        setItems([])
        setError(err instanceof ApiError ? err.message : 'Failed to load audit logs')
      })
      .finally(() => setLoading(false))
  }

  async function handleExport() {
    setError(null)
    try {
      await exportAuditLogs(currentFilters())
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to export audit logs')
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <div className="flex flex-col gap-6 p-6">
      <h1 className="text-xl font-semibold">Audit Logs</h1>
      <p className="text-sm text-muted-foreground">
        Every state-changing request across the app, recorded automatically — append-only, no
        edit or delete.
      </p>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="rounded-md border p-4 text-sm">
        <div className="mb-3 flex flex-wrap items-end gap-2">
          <div>
            <Label>Module</Label>
            <Input
              placeholder="e.g. helpdesk"
              value={moduleFilter}
              onChange={(e) => setModuleFilter(e.target.value)}
            />
          </div>
          <div>
            <Label>Actor ID</Label>
            <Input value={actorFilter} onChange={(e) => setActorFilter(e.target.value)} />
          </div>
          <div>
            <Label>From</Label>
            <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          </div>
          <div>
            <Label>To</Label>
            <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          </div>
          <Button size="sm" variant="outline" onClick={() => refresh(1)}>
            Apply Filters
          </Button>
          <Button size="sm" variant="outline" onClick={handleExport}>
            Export CSV
          </Button>
        </div>

        {loading && <p className="text-muted-foreground">Loading…</p>}

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b">
                <th className="p-1">Time</th>
                <th className="p-1">Module</th>
                <th className="p-1">Method</th>
                <th className="p-1">Path</th>
                <th className="p-1">Actor</th>
                <th className="p-1">Role</th>
                <th className="p-1">Status</th>
              </tr>
            </thead>
            <tbody>
              {items.map((log) => (
                <tr key={log.id} className="border-b">
                  <td className="p-1">{new Date(log.createdAt).toLocaleString()}</td>
                  <td className="p-1">{log.module}</td>
                  <td className="p-1">{log.method}</td>
                  <td className="p-1">{log.path}</td>
                  <td className="p-1">{log.actorId ?? 'anonymous'}</td>
                  <td className="p-1">{log.actorRole ?? '—'}</td>
                  <td className="p-1">{log.statusCode ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!loading && items.length === 0 && (
            <p className="p-2 text-muted-foreground">No audit log entries match these filters.</p>
          )}
        </div>

        <div className="mt-3 flex items-center justify-between">
          <span className="text-muted-foreground">
            Page {page} of {totalPages} ({total} total)
          </span>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={page <= 1}
              onClick={() => refresh(page - 1)}
            >
              Previous
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={page >= totalPages}
              onClick={() => refresh(page + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
