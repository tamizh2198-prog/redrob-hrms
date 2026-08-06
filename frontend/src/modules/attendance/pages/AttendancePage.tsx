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
import { useAuth } from '@/shared/auth/AuthContext'
import { ApiError } from '@/lib/api'
import {
  punch,
  getCalendar,
  regularize,
  listRegularizations,
  decideRegularization,
  importBiometric,
  lockMonth,
  type AttendanceStatus,
  type CalendarDay,
  type RegularizationRequest,
} from '../api'

const STATUS_COLOR: Record<AttendanceStatus, string> = {
  PRESENT: 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300',
  ABSENT: 'bg-destructive/20 text-destructive',
  HALF_DAY: 'bg-amber-500/20 text-amber-700 dark:text-amber-300',
  LATE: 'bg-orange-500/20 text-orange-700 dark:text-orange-300',
  EARLY_EXIT: 'bg-orange-500/20 text-orange-700 dark:text-orange-300',
  ON_LEAVE: 'bg-blue-500/20 text-blue-700 dark:text-blue-300',
  HOLIDAY: 'bg-purple-500/20 text-purple-700 dark:text-purple-300',
  WEEK_OFF: 'bg-muted text-muted-foreground',
  WFH: 'bg-cyan-500/20 text-cyan-700 dark:text-cyan-300',
}

const now = new Date()

export function AttendancePage() {
  const { user } = useAuth()
  const isHrAdmin = user?.role === 'HR_ADMIN' || user?.role === 'SUPER_ADMIN'

  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [days, setDays] = useState<CalendarDay[]>([])
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [regDate, setRegDate] = useState('')
  const [regStatus, setRegStatus] = useState<AttendanceStatus>('PRESENT')
  const [regReason, setRegReason] = useState('')

  const [pending, setPending] = useState<RegularizationRequest[]>([])

  const [importRaw, setImportRaw] = useState('')
  const [importResult, setImportResult] = useState<string | null>(null)

  function loadCalendar() {
    if (!user) return
    getCalendar(user.id, year, month).then(setDays).catch(() => setDays([]))
  }

  function loadPending() {
    if (!user) return
    listRegularizations({ approverId: user.id, status: 'PENDING' })
      .then(setPending)
      .catch(() => setPending([]))
  }

  useEffect(() => {
    loadCalendar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, month, user?.id])

  useEffect(() => {
    loadPending()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id])

  async function handlePunch(type: 'IN' | 'OUT') {
    setError(null)
    setMessage(null)
    try {
      const res = await punch(type)
      setMessage(`Punched ${type}. Status: ${res.status}`)
      loadCalendar()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Punch failed')
    }
  }

  async function handleRegularize() {
    setError(null)
    setMessage(null)
    try {
      await regularize({ date: regDate, requestedStatus: regStatus, reason: regReason })
      setMessage('Regularization request submitted.')
      setRegDate('')
      setRegReason('')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to submit request')
    }
  }

  async function handleDecision(id: string, approve: boolean) {
    await decideRegularization(id, approve)
    setPending((p) => p.filter((r) => r.id !== id))
  }

  async function handleImport() {
    setError(null)
    try {
      const rows = JSON.parse(importRaw || '[]')
      const res = await importBiometric(rows)
      setImportResult(
        `${res.matchedCount}/${res.totalRows} matched. Unmatched: ${
          res.unmatched.map((u) => u.employeeCode).join(', ') || 'none'
        }`,
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed')
    }
  }

  async function handleLock() {
    setError(null)
    try {
      const res = await lockMonth(year, month)
      setMessage(`Locked ${res.lockedRecords} record(s) for ${month}/${year}.`)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Lock failed')
    }
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <h1 className="text-xl font-semibold">Attendance</h1>

      {message && <p className="text-sm text-primary">{message}</p>}
      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex gap-2">
        <Button onClick={() => handlePunch('IN')}>Punch In</Button>
        <Button variant="outline" onClick={() => handlePunch('OUT')}>
          Punch Out
        </Button>
      </div>

      <div className="flex items-center gap-2">
        <Label>Month</Label>
        <Input
          type="number"
          className="w-20"
          value={month}
          onChange={(e) => setMonth(Number(e.target.value))}
        />
        <Label>Year</Label>
        <Input
          type="number"
          className="w-24"
          value={year}
          onChange={(e) => setYear(Number(e.target.value))}
        />
      </div>

      <div className="grid grid-cols-7 gap-1">
        {days.map((d) => (
          <div
            key={d.date}
            className={`rounded-md p-2 text-center text-xs ${STATUS_COLOR[d.status]}`}
            title={d.status}
          >
            <div>{d.date.slice(-2)}</div>
            <div className="truncate">{d.status}</div>
          </div>
        ))}
      </div>

      <div className="rounded-md border p-4">
        <h2 className="mb-2 font-medium">Submit Regularization</h2>
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex flex-col gap-1">
            <Label>Date</Label>
            <Input type="date" value={regDate} onChange={(e) => setRegDate(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <Label>Requested status</Label>
            <Select value={regStatus} onValueChange={(v) => setRegStatus(v as AttendanceStatus)}>
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(['PRESENT', 'HALF_DAY', 'WFH'] as AttendanceStatus[]).map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <Label>Reason</Label>
            <Input value={regReason} onChange={(e) => setRegReason(e.target.value)} />
          </div>
          <Button onClick={handleRegularize}>Submit</Button>
        </div>
      </div>

      {pending.length > 0 && (
        <div className="rounded-md border p-4">
          <h2 className="mb-2 font-medium">Pending Regularizations to Decide</h2>
          <ul className="flex flex-col gap-2 text-sm">
            {pending.map((r) => (
              <li key={r.id} className="flex items-center justify-between">
                <span>
                  {r.date.slice(0, 10)} → {r.requestedStatus}: {r.reason}
                </span>
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => handleDecision(r.id, true)}>
                    Approve
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => handleDecision(r.id, false)}>
                    Reject
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {isHrAdmin && (
        <div className="rounded-md border p-4">
          <h2 className="mb-2 font-medium">Biometric Import (HR Admin)</h2>
          <textarea
            className="w-full rounded-md border bg-transparent p-2 font-mono text-xs"
            rows={6}
            value={importRaw}
            onChange={(e) => setImportRaw(e.target.value)}
            placeholder='[{"employeeCode":"EMP-2026-0001","date":"2026-08-06","checkInTime":"2026-08-06T09:00:00","checkOutTime":"2026-08-06T18:00:00"}]'
          />
          <div className="mt-2 flex gap-2">
            <Button variant="outline" onClick={handleImport}>
              Import
            </Button>
            <Button variant="outline" onClick={handleLock}>
              Lock {month}/{year}
            </Button>
          </div>
          {importResult && <p className="mt-2 text-sm">{importResult}</p>}
        </div>
      )}
    </div>
  )
}
