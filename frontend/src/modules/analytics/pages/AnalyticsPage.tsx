import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useAuth } from '@/shared/auth/AuthContext'
import { ApiError } from '@/lib/api'
import { getReferenceData, type ManagerOption, type ReferenceOption } from '@/modules/employee/api'
import {
  getDashboard,
  listReportEntities,
  buildReport,
  exportReport,
  listSavedReports,
  createSavedReport,
  deleteSavedReport,
  type Dashboard,
  type ReportEntity,
  type ReportResult,
  type ReportRow,
  type ExportFormat,
  type SavedReport,
  type ReportSchedule,
} from '../api'

function label(value: string) {
  return value.replaceAll('_', ' ')
}

function EmployeeDashboardView({ d }: { d: Dashboard & { role: 'EMPLOYEE' } }) {
  return (
    <div className="flex flex-col gap-1">
      <p>My open tickets: {d.myOpenTickets}</p>
    </div>
  )
}

function ManagerDashboardView({ d }: { d: Dashboard & { role: 'MANAGER' } }) {
  return (
    <div className="flex flex-col gap-1">
      <p>Team size: {d.teamSize}</p>
      <p>Team goal progress: {d.teamGoalProgressPercent ?? '—'}%</p>
    </div>
  )
}

function HrAdminDashboardView({ d }: { d: Dashboard & { role: 'HR_ADMIN' | 'SUPER_ADMIN' } }) {
  return (
    <div className="flex flex-col gap-1">
      <p className="font-medium">Headcount by Status</p>
      <p>{d.headcountByStatus.map((h) => `${label(h.status)}: ${h.count}`).join(', ') || '—'}</p>
      <p>Attrition (last 90 days): {d.attritionLast90Days}</p>
      <p className="mt-2 font-medium">Hiring Funnel</p>
      <p>{d.hiringFunnel.map((h) => `${label(h.stage)}: ${h.count}`).join(', ') || '—'}</p>
      <p>Open requisitions: {d.openRequisitions}</p>
    </div>
  )
}

export function AnalyticsPage() {
  const { user } = useAuth()
  const isHrAdmin = user?.role === 'HR_ADMIN' || user?.role === 'SUPER_ADMIN' || user?.role === 'HR_ASSOCIATE'

  const [dashboard, setDashboard] = useState<Dashboard | null>(null)
  const [entities, setEntities] = useState<ReportEntity[]>([])
  const [entityKey, setEntityKey] = useState('')
  const [departmentId, setDepartmentId] = useState('')
  const [locationId, setLocationId] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [status, setStatus] = useState('')
  const [groupBy, setGroupBy] = useState('')
  const [result, setResult] = useState<ReportResult | null>(null)
  const [drilldownKey, setDrilldownKey] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const [people, setPeople] = useState<ManagerOption[]>([])
  const [departments, setDepartments] = useState<ReferenceOption[]>([])
  const [locations, setLocations] = useState<ReferenceOption[]>([])
  const [savedReports, setSavedReports] = useState<SavedReport[]>([])
  const [savedName, setSavedName] = useState('')
  const [savedSchedule, setSavedSchedule] = useState<ReportSchedule>('WEEKLY')
  const [savedRecipientIds, setSavedRecipientIds] = useState<string[]>([])

  useEffect(() => {
    getDashboard().then(setDashboard).catch(() => setDashboard(null))
    if (isHrAdmin) {
      listReportEntities().then(setEntities).catch(() => setEntities([]))
      refreshSavedReports()
      getReferenceData()
        .then((r) => {
          setPeople(r.managers)
          setDepartments(r.departments)
          setLocations(r.locations)
        })
        .catch(() => {
          setPeople([])
          setDepartments([])
          setLocations([])
        })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function refreshSavedReports() {
    listSavedReports().then(setSavedReports).catch(() => setSavedReports([]))
  }

  function toggleRecipient(id: string) {
    setSavedRecipientIds((prev) => (prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]))
  }

  function personName(id: string) {
    const p = people.find((m) => m.id === id)
    return p ? `${p.firstName} ${p.lastName}` : id
  }

  async function handleCreateSavedReport() {
    if (!entityKey || !savedName || savedRecipientIds.length === 0) return
    setError(null)
    setMessage(null)
    try {
      await createSavedReport({
        name: savedName,
        config: currentFilters(),
        schedule: savedSchedule,
        recipientIds: savedRecipientIds,
      })
      setMessage('Scheduled report saved.')
      setSavedName('')
      setSavedRecipientIds([])
      refreshSavedReports()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to save scheduled report')
    }
  }

  async function handleDeleteSavedReport(id: string) {
    setError(null)
    try {
      await deleteSavedReport(id)
      refreshSavedReports()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to delete scheduled report')
    }
  }

  const selectedEntity = entities.find((e) => e.key === entityKey)

  function currentFilters() {
    return {
      entity: entityKey,
      departmentId: departmentId || undefined,
      locationId: locationId || undefined,
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
      status: status || undefined,
      groupBy: groupBy || undefined,
    }
  }

  async function handleBuildReport() {
    if (!entityKey) return
    setError(null)
    setDrilldownKey(null)
    try {
      const r = await buildReport(currentFilters())
      setResult(r)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to build report')
    }
  }

  async function handleExport(format: ExportFormat) {
    if (!entityKey) return
    setError(null)
    try {
      await exportReport(currentFilters(), format)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to export report')
    }
  }

  const drilldownRows: ReportRow[] =
    result && drilldownKey
      ? result.rows.filter((r) => {
          const group = result.groups?.find((g) => g.key === drilldownKey)
          return group?.recordIds.includes(r.id)
        })
      : []

  return (
    <div className="flex flex-col gap-6 p-6">
      <h1 className="text-xl font-semibold">Analytics</h1>

      {message && <p className="text-sm text-primary">{message}</p>}
      {error && <p className="text-sm text-destructive">{error}</p>}

      <Card>
        <CardHeader>
          <CardTitle>Dashboard</CardTitle>
        </CardHeader>
        <CardContent className="text-sm">
        {!dashboard && <p className="text-muted-foreground">Loading dashboard…</p>}
        {dashboard?.role === 'EMPLOYEE' && <EmployeeDashboardView d={dashboard} />}
        {dashboard?.role === 'MANAGER' && <ManagerDashboardView d={dashboard} />}
        {(dashboard?.role === 'HR_ADMIN' || dashboard?.role === 'SUPER_ADMIN') && (
          <HrAdminDashboardView d={dashboard} />
        )}
        </CardContent>
      </Card>

      {isHrAdmin && (
        <Card>
          <CardHeader>
            <CardTitle>Report Builder</CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex flex-col gap-1">
              <Label>Entity</Label>
              <Select
                value={entityKey}
                onValueChange={(v) => {
                  setEntityKey(v)
                  setGroupBy('')
                  // Status options are entity-specific (EmployeeStatus vs
                  // CandidateStage vs AssetStatus, etc.) — a value valid for
                  // the previous entity may not exist for the new one.
                  setStatus('')
                  setResult(null)
                }}
              >
                <SelectTrigger className="w-48">
                  <SelectValue placeholder="Select entity">
                    {(v: string) => entities.find((e) => e.key === v)?.label ?? v}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {entities.map((e) => (
                    <SelectItem key={e.key} value={e.key}>
                      {e.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-1">
              <Label>Department</Label>
              <Select value={departmentId} onValueChange={setDepartmentId}>
                <SelectTrigger className="w-44">
                  <SelectValue placeholder="All departments">
                    {(v: string) => departments.find((d) => d.id === v)?.name ?? 'All departments'}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">All departments</SelectItem>
                  {departments.map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      {d.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-1">
              <Label>Location</Label>
              <Select value={locationId} onValueChange={setLocationId}>
                <SelectTrigger className="w-44">
                  <SelectValue placeholder="All locations">
                    {(v: string) => locations.find((l) => l.id === v)?.name ?? 'All locations'}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">All locations</SelectItem>
                  {locations.map((l) => (
                    <SelectItem key={l.id} value={l.id}>
                      {l.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-1">
              <Label>Date From</Label>
              <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
            </div>

            <div className="flex flex-col gap-1">
              <Label>Date To</Label>
              <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
            </div>

            <div className="flex flex-col gap-1">
              <Label>Status</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger className="w-40">
                  <SelectValue placeholder="Any status">{(v: string) => (v ? label(v) : 'Any status')}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Any status</SelectItem>
                  {selectedEntity?.statusOptions.map((s) => (
                    <SelectItem key={s} value={s}>
                      {label(s)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-1">
              <Label>Group By</Label>
              <Select value={groupBy} onValueChange={setGroupBy}>
                <SelectTrigger className="w-40">
                  <SelectValue placeholder="None">{(v: string) => (v ? label(v) : 'None')}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">None</SelectItem>
                  {selectedEntity?.groupableFields.map((f) => (
                    <SelectItem key={f} value={f}>
                      {label(f)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <Button size="sm" variant="outline" onClick={handleBuildReport} disabled={!entityKey}>
              Run Report
            </Button>
            <Button size="sm" variant="outline" onClick={() => handleExport('csv')} disabled={!entityKey}>
              Export CSV
            </Button>
            <Button size="sm" variant="outline" onClick={() => handleExport('excel')} disabled={!entityKey}>
              Export Excel
            </Button>
            <Button size="sm" variant="outline" onClick={() => handleExport('pdf')} disabled={!entityKey}>
              Export PDF
            </Button>
          </div>

          {result && (
            <div className="mt-4 flex flex-col gap-3">
              <p className="text-muted-foreground">{result.total} record(s)</p>

              {result.groups && (
                <div>
                  <p className="mb-1 font-medium">Groups (click to drill down)</p>
                  <div className="flex flex-wrap gap-2">
                    {result.groups.map((g) => (
                      <button key={g.key} onClick={() => setDrilldownKey(g.key)}>
                        <Badge variant={drilldownKey === g.key ? 'default' : 'outline'}>
                          {g.key}: {g.count}
                        </Badge>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b">
                      {(drilldownKey ? drilldownRows[0] : result.rows[0]) &&
                        Object.keys((drilldownKey ? drilldownRows[0] : result.rows[0]) ?? {}).map((f) => (
                          <th key={f} className="p-1">
                            {label(f)}
                          </th>
                        ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(drilldownKey ? drilldownRows : result.rows).map((r) => (
                      <tr key={r.id} className="border-b">
                        {Object.entries(r).map(([k, v]) => (
                          <td key={k} className="p-1">
                            {v === null || v === undefined ? '—' : String(v)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {(drilldownKey ? drilldownRows : result.rows).length === 0 && (
                  <p className="p-2 text-muted-foreground">No records match these filters.</p>
                )}
              </div>
            </div>
          )}
          </CardContent>
        </Card>
      )}

      {isHrAdmin && (
        <Card>
          <CardHeader>
            <CardTitle>Scheduled Reports</CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
          <p className="mb-2 text-muted-foreground">
            Save the current Report Builder filters above as a recurring email. Recipients are
            re-checked for HR Admin access each time it sends — anyone who no longer qualifies is
            skipped automatically.
          </p>

          <ul className="mb-3 flex flex-col gap-2">
            {savedReports.map((r) => (
              <li key={r.id} className="flex items-center justify-between rounded border p-2">
                <div>
                  <p className="font-medium">
                    {r.name} — {r.config.entity} ({label(r.schedule)})
                  </p>
                  <p className="text-muted-foreground">
                    Recipients: {r.recipientIds.map(personName).join(', ') || '—'} · Last run:{' '}
                    {r.lastRunAt ? new Date(r.lastRunAt).toLocaleString() : 'never'}
                  </p>
                </div>
                <Button size="sm" variant="outline" onClick={() => handleDeleteSavedReport(r.id)}>
                  Delete
                </Button>
              </li>
            ))}
            {savedReports.length === 0 && <p className="text-muted-foreground">No scheduled reports yet.</p>}
          </ul>

          <div className="flex flex-wrap items-end gap-2">
            <div className="flex flex-col gap-1">
              <Label>Name</Label>
              <Input className="w-48" value={savedName} onChange={(e) => setSavedName(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1">
              <Label>Schedule</Label>
              <Select value={savedSchedule} onValueChange={(v) => setSavedSchedule(v as ReportSchedule)}>
                <SelectTrigger className="w-32">
                  <SelectValue placeholder="Schedule">{(v: string) => label(v)}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="DAILY">Daily</SelectItem>
                  <SelectItem value="WEEKLY">Weekly</SelectItem>
                  <SelectItem value="MONTHLY">Monthly</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button size="sm" variant="outline" onClick={handleCreateSavedReport} disabled={!entityKey}>
              Save Schedule (uses filters above)
            </Button>
          </div>

          <div className="mt-2 flex flex-col gap-1">
            <Label>Recipients</Label>
            <div className="flex flex-wrap gap-3">
              {people.map((p) => (
                <label key={p.id} className="flex items-center gap-1 text-xs">
                  <input
                    type="checkbox"
                    checked={savedRecipientIds.includes(p.id)}
                    onChange={() => toggleRecipient(p.id)}
                  />
                  {p.firstName} {p.lastName}
                </label>
              ))}
              {people.length === 0 && <p className="text-muted-foreground">No people available.</p>}
            </div>
          </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
