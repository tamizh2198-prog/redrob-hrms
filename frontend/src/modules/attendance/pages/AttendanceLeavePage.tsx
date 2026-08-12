import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ChevronLeft, ChevronRight, Pencil, Upload, CalendarPlus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog'
import { useAuth } from '@/shared/auth/AuthContext'
import { ApiError } from '@/lib/api'
import {
  punch,
  getCalendar,
  listRegularizations,
  decideRegularization,
  importBiometric,
  lockMonth,
  ATTENDANCE_STATUS_COLOR,
  formatDuration,
  formatTime,
  type CalendarDay,
  type CalendarDayStatus,
  type RegularizationRequest,
} from '../api'
import { RegularizeDialog } from '../components/RegularizeDialog'
import {
  listLeaveTypes,
  createLeaveType,
  getBalances,
  applyLeave,
  decideLeave,
  cancelLeave,
  myApplications,
  pendingApprovals,
  listPendingRequests,
  isHalfDayApplication,
  type LeaveType,
  type LeaveBalanceEntry,
  type LeaveApplication,
} from '@/modules/leave/api'
import { getDashboard, type Dashboard } from '@/modules/analytics/api'

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

const SAMPLE_BIOMETRIC_ROWS = [
  {
    employeeCode: 'EMP-2026-0001',
    date: '2026-08-06',
    checkInTime: '2026-08-06T09:00:00',
    checkOutTime: '2026-08-06T18:00:00',
  },
]

function todayIso() {
  return new Date().toISOString().slice(0, 10)
}

// This task: purely cosmetic — "12th Aug 2026" to match the reference
// design's card heading. No attendance/leave logic reads this string.
function formatFriendlyDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00`)
  const day = d.getDate()
  const suffix =
    day % 10 === 1 && day !== 11 ? 'st'
    : day % 10 === 2 && day !== 12 ? 'nd'
    : day % 10 === 3 && day !== 13 ? 'rd'
    : 'th'
  return `${day}${suffix} ${d.toLocaleString('en-US', { month: 'short' })} ${d.getFullYear()}`
}

function statusLabel(status: CalendarDayStatus): string {
  if (status === 'WEEK_OFF') return 'Weekend'
  if (status === 'UPCOMING') return 'Upcoming'
  return status.replaceAll('_', ' ')
}

// This task: groups a cluster of related sections into one visually
// continuous panel (matches the reference screenshot's card layout) while
// every section inside stays the exact same markup/logic as before —
// purely a presentational wrapper, divide-y draws the internal separators.
function Panel({ children }: { children: ReactNode }) {
  return (
    <div className="divide-y divide-border overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
      {children}
    </div>
  )
}

function PanelSection({ children }: { children: ReactNode }) {
  return <div className="p-4">{children}</div>
}

// This task: the single employee self-service surface for Attendance +
// Leave, replacing the previously separate /attendance and /leave pages
// and the Super-Admin-only combined admin page — all of it reuses the
// exact same backend APIs those pages already called.
export function AttendanceLeavePage() {
  const { user } = useAuth()
  const isHrAdmin = user?.role === 'HR_ADMIN' || user?.role === 'SUPER_ADMIN'
  const isSuperAdmin = user?.role === 'SUPER_ADMIN'

  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [days, setDays] = useState<CalendarDay[]>([])
  const [attMessage, setAttMessage] = useState<string | null>(null)
  const [attError, setAttError] = useState<string | null>(null)
  const [punching, setPunching] = useState(false)

  const [pendingRegularizations, setPendingRegularizations] = useState<RegularizationRequest[]>([])

  const [importRaw, setImportRaw] = useState('')
  const [importFileName, setImportFileName] = useState<string | null>(null)
  const [importResult, setImportResult] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [leaveTypes, setLeaveTypes] = useState<LeaveType[]>([])
  const [balances, setBalances] = useState<LeaveBalanceEntry[]>([])
  const [myApps, setMyApps] = useState<LeaveApplication[]>([])
  const [pendingApprovalsList, setPendingApprovalsList] = useState<LeaveApplication[]>([])
  const [companyPending, setCompanyPending] = useState<LeaveApplication[]>([])
  const [dashboard, setDashboard] = useState<Dashboard | null>(null)

  const [leaveTypeId, setLeaveTypeId] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [reason, setReason] = useState('')
  const [duration, setDuration] = useState<'FULL_DAY' | 'HALF_DAY'>('FULL_DAY')

  const [newTypeName, setNewTypeName] = useState('')
  const [newTypeCode, setNewTypeCode] = useState('')
  const [newTypeFrequency, setNewTypeFrequency] = useState<'MONTHLY' | 'QUARTERLY' | 'ANNUAL'>('MONTHLY')
  const [newTypeRate, setNewTypeRate] = useState('1')

  const [leaveMessage, setLeaveMessage] = useState<string | null>(null)
  const [leaveError, setLeaveError] = useState<string | null>(null)
  const [decidingId, setDecidingId] = useState<string | null>(null)
  const [applyDialogOpen, setApplyDialogOpen] = useState(false)

  // This task: "My Leave Applications" is no longer shown by default — the
  // sidebar's "View Leaves Taken" button reveals it (and scrolls to it),
  // clicking again hides it. Same myApps data/table, just conditionally
  // rendered instead of always-visible.
  const [showLeaveHistory, setShowLeaveHistory] = useState(false)
  const [expandedBalances, setExpandedBalances] = useState<Set<string>>(new Set())

  function toggleBalanceDetails(leaveTypeId: string) {
    setExpandedBalances((prev) => {
      const next = new Set(prev)
      if (next.has(leaveTypeId)) next.delete(leaveTypeId)
      else next.add(leaveTypeId)
      return next
    })
  }

  function leaveTypeLabel(lt: LeaveType) {
    return lt.code ? `${lt.name} (${lt.code})` : lt.name
  }

  function loadCalendar() {
    if (!user) return
    getCalendar(user.id, year, month).then(setDays).catch(() => setDays([]))
  }

  function loadPendingRegularizations() {
    if (!user) return
    listRegularizations({ approverId: user.id, status: 'PENDING' })
      .then(setPendingRegularizations)
      .catch(() => setPendingRegularizations([]))
  }

  // This task: awaitable (was fire-and-forget) so callers like
  // handleLeaveDecision can be sure the pending list/history/balance have
  // actually finished refreshing with server-confirmed state before
  // clearing their own "in progress" flag — the UI no longer shows a stale
  // pending row nor relies on an optimistic local removal.
  async function loadLeave() {
    if (!user) return
    const tasks = [
      listLeaveTypes().then(setLeaveTypes).catch(() => setLeaveTypes([])),
      getBalances(user.id).then(setBalances).catch(() => setBalances([])),
      myApplications().then(setMyApps).catch(() => setMyApps([])),
      pendingApprovals().then(setPendingApprovalsList).catch(() => setPendingApprovalsList([])),
    ]
    if (isSuperAdmin) {
      tasks.push(
        listPendingRequests().then(setCompanyPending).catch(() => setCompanyPending([])),
        getDashboard().then(setDashboard).catch(() => setDashboard(null)),
      )
    }
    await Promise.all(tasks)
  }

  useEffect(() => {
    loadCalendar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, month, user?.id])

  useEffect(() => {
    if (showLeaveHistory) {
      document.getElementById('my-leave-applications')?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [showLeaveHistory])

  useEffect(() => {
    loadPendingRegularizations()
    loadLeave()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id])

  const today = todayIso()
  const todayEntry = days.find((d) => d.date === today)

  async function handlePunch(type: 'IN' | 'OUT') {
    setPunching(true)
    setAttError(null)
    setAttMessage(null)
    try {
      const res = await punch(type)
      setAttMessage(`Punched ${type}. Status: ${res.status}`)
      loadCalendar()
      if (isSuperAdmin) getDashboard().then(setDashboard).catch(() => setDashboard(null))
    } catch (err) {
      setAttError(err instanceof ApiError ? err.message : 'Punch failed')
    } finally {
      setPunching(false)
    }
  }

  async function handleRegularizationDecision(id: string, approve: boolean) {
    await decideRegularization(id, approve)
    setPendingRegularizations((p) => p.filter((r) => r.id !== id))
    loadCalendar()
  }

  function loadFileIntoImportRaw(file: File) {
    const reader = new FileReader()
    reader.onload = () => {
      setImportRaw(String(reader.result ?? ''))
      setImportFileName(file.name)
    }
    reader.readAsText(file)
  }

  async function handleImport() {
    setAttError(null)
    try {
      const rows = JSON.parse(importRaw || '[]')
      const res = await importBiometric(rows)
      setImportResult(
        `${res.matchedCount}/${res.totalRows} matched. Unmatched: ${
          res.unmatched.map((u) => u.employeeCode).join(', ') || 'none'
        }`,
      )
    } catch (err) {
      setAttError(err instanceof Error ? err.message : 'Import failed')
    }
  }

  async function handleLock() {
    setAttError(null)
    try {
      const res = await lockMonth(year, month)
      setAttMessage(`Locked ${res.lockedRecords} record(s) for ${month}/${year}.`)
    } catch (err) {
      setAttError(err instanceof ApiError ? err.message : 'Lock failed')
    }
  }

  function goToToday() {
    setYear(now.getFullYear())
    setMonth(now.getMonth() + 1)
  }

  function shiftMonth(delta: number) {
    const d = new Date(year, month - 1 + delta, 1)
    setYear(d.getFullYear())
    setMonth(d.getMonth() + 1)
  }

  async function handleApplyLeave() {
    setLeaveError(null)
    setLeaveMessage(null)
    try {
      const app = await applyLeave({
        leaveTypeId,
        startDate,
        endDate: duration === 'HALF_DAY' ? startDate : endDate,
        reason,
        duration,
      })
      setLeaveMessage(`Applied for ${isHalfDayApplication(app) ? 'Half Day' : `${app.daysCount} day(s)`}. Status: PENDING.`)
      setStartDate('')
      setEndDate('')
      setReason('')
      setDuration('FULL_DAY')
      setApplyDialogOpen(false)
      await loadLeave()
    } catch (err) {
      setLeaveError(err instanceof ApiError ? err.message : 'Failed to apply')
    }
  }

  // This task: fixes the reported "doesn't reliably show the result" bug —
  // the row is only ever removed by the awaited refetch inside loadLeave()
  // (never optimistically beforehand), a success message is now always
  // shown, and decidingId only clears once that refetch has actually
  // landed, so the UI never flashes stale pending state.
  async function handleLeaveDecision(id: string, approve: boolean) {
    setDecidingId(id)
    setLeaveError(null)
    setLeaveMessage(null)
    try {
      await decideLeave(id, approve)
      await loadLeave()
      setLeaveMessage(approve ? 'Leave request approved.' : 'Leave request rejected.')
    } catch (err) {
      setLeaveError(err instanceof ApiError ? err.message : 'Failed to record decision')
    } finally {
      setDecidingId(null)
    }
  }

  async function handleCancel(id: string) {
    await cancelLeave(id)
    loadLeave()
  }

  async function handleCreateType() {
    setLeaveError(null)
    try {
      await createLeaveType({
        name: newTypeName,
        code: newTypeCode || undefined,
        accrualFrequency: newTypeFrequency,
        accrualRate: Number(newTypeRate),
      })
      setNewTypeName('')
      setNewTypeCode('')
      setNewTypeRate('1')
      loadLeave()
    } catch (err) {
      setLeaveError(err instanceof ApiError ? err.message : 'Failed to create leave type')
    }
  }

  const attendanceToday =
    dashboard && (dashboard.role === 'HR_ADMIN' || dashboard.role === 'SUPER_ADMIN')
      ? dashboard.attendanceToday
      : []
  const attendancePercent =
    dashboard && (dashboard.role === 'HR_ADMIN' || dashboard.role === 'SUPER_ADMIN')
      ? dashboard.attendancePercentToday
      : null
  function countFor(status: string) {
    return attendanceToday.find((a) => a.status === status)?.count ?? 0
  }

  const sampleHref = `data:application/json;charset=utf-8,${encodeURIComponent(
    JSON.stringify(SAMPLE_BIOMETRIC_ROWS, null, 2),
  )}`

  return (
    <div className="flex flex-col gap-6 p-6 lg:flex-row lg:items-start">
      <div className="flex min-w-0 flex-1 flex-col gap-6">
        <h1 className="text-xl font-semibold">Attendance & Leave</h1>

        {/* Attendance cluster: Today's Attendance + (optional) company
            summary + Monthly Attendance + (optional) regularizations to
            decide, grouped as one continuous panel per the reference. */}
        <Panel>
          <PanelSection>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-medium">Today's Attendance ({formatFriendlyDate(today)})</h2>
              {todayEntry && (
                <Badge className={ATTENDANCE_STATUS_COLOR[todayEntry.status]} variant="outline">
                  {statusLabel(todayEntry.status)}
                </Badge>
              )}
            </div>
            {attMessage && <p className="mb-2 text-sm text-primary">{attMessage}</p>}
            {attError && <p className="mb-2 text-sm text-destructive">{attError}</p>}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="rounded-lg border p-3">
                <div className="text-sm text-muted-foreground">Check In</div>
                <div className="mt-1 text-lg font-semibold">{formatTime(todayEntry?.checkInTime ?? null)}</div>
              </div>
              <div className="rounded-lg border p-3">
                <div className="text-sm text-muted-foreground">Check Out</div>
                <div className="mt-1 text-lg font-semibold">{formatTime(todayEntry?.checkOutTime ?? null)}</div>
              </div>
            </div>
            {/* This task: one dynamic button instead of two separate
                Punch In/Punch Out buttons — state comes purely from the
                existing todayEntry (backend calendar state), same
                handlePunch()/5-minute rule as before. */}
            <Button
              className="mt-3 w-full sm:w-auto"
              disabled={punching || Boolean(todayEntry?.checkOutTime)}
              variant={todayEntry?.checkOutTime ? 'outline' : 'default'}
              onClick={() => {
                if (!todayEntry?.checkInTime) handlePunch('IN')
                else if (!todayEntry?.checkOutTime) handlePunch('OUT')
              }}
            >
              {!todayEntry?.checkInTime
                ? 'Punch In'
                : !todayEntry?.checkOutTime
                  ? 'Punch Out'
                  : 'Attendance Complete'}
            </Button>
            {todayEntry?.workHours != null && (
              <p className="mt-2 text-sm text-muted-foreground">
                Worked: {formatDuration(todayEntry.workHours)}
              </p>
            )}
          </PanelSection>

          {isSuperAdmin && dashboard && (
            <PanelSection>
              <h2 className="mb-2 font-medium">Attendance Summary (Company-wide, today)</h2>
              <div className="flex flex-wrap gap-6 text-sm">
                <SummaryStat label="Present" value={countFor('PRESENT')} />
                <SummaryStat label="Absent" value={countFor('ABSENT')} />
                <SummaryStat label="On Leave" value={countFor('ON_LEAVE')} />
                <SummaryStat label="Half Day" value={countFor('HALF_DAY')} />
                <SummaryStat label="Late" value={countFor('LATE')} />
                <SummaryStat
                  label="Attendance %"
                  value={attendancePercent === null ? '—' : `${attendancePercent}%`}
                />
              </div>
            </PanelSection>
          )}

          <PanelSection>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-medium">Monthly Attendance</h2>
              <div className="flex items-center gap-2">
                <Button size="icon-sm" variant="outline" onClick={() => shiftMonth(-1)} aria-label="Previous month">
                  <ChevronLeft />
                </Button>
                <Select value={String(month)} onValueChange={(v) => setMonth(Number(v))}>
                  <SelectTrigger className="w-32">
                    <SelectValue>{MONTH_NAMES[month - 1]}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {MONTH_NAMES.map((m, i) => (
                      <SelectItem key={m} value={String(i + 1)}>
                        {m}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  type="number"
                  className="w-24"
                  value={year}
                  onChange={(e) => setYear(Number(e.target.value))}
                />
                <Button size="icon-sm" variant="outline" onClick={() => shiftMonth(1)} aria-label="Next month">
                  <ChevronRight />
                </Button>
                <Button size="sm" variant="outline" onClick={goToToday}>
                  Today
                </Button>
              </div>
            </div>

            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Check In</TableHead>
                    <TableHead>Check Out</TableHead>
                    <TableHead>Duration</TableHead>
                    <TableHead>Remarks</TableHead>
                    <TableHead>Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {days.map((d) => {
                    const isFutureDay = d.date > today
                    return (
                      <TableRow key={d.date}>
                        <TableCell>{d.date}</TableCell>
                        <TableCell>
                          <Badge className={ATTENDANCE_STATUS_COLOR[d.status]} variant="outline">
                            {statusLabel(d.status)}
                          </Badge>
                        </TableCell>
                        <TableCell>{formatTime(d.checkInTime)}</TableCell>
                        <TableCell>{formatTime(d.checkOutTime)}</TableCell>
                        <TableCell>{formatDuration(d.workHours)}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {d.regularization
                            ? `${d.regularization.status}: ${d.regularization.reason}`
                            : '—'}
                        </TableCell>
                        <TableCell>
                          {!isFutureDay && (
                            <RegularizeDialog
                              date={d.date}
                              currentStatus={d.status}
                              onSubmitted={loadCalendar}
                              trigger={
                                <Button size="icon-sm" variant="ghost" aria-label="Regularize">
                                  <Pencil />
                                </Button>
                              }
                            />
                          )}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                  {days.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center text-muted-foreground">
                        No attendance data for this month.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </PanelSection>

          {pendingRegularizations.length > 0 && (
            <PanelSection>
              <h2 className="mb-2 font-medium">Pending Regularizations to Decide</h2>
              <ul className="flex flex-col gap-2 text-sm">
                {pendingRegularizations.map((r) => (
                  <li key={r.id} className="flex items-center justify-between">
                    <span>
                      {r.date.slice(0, 10)} → {r.requestedStatus}: {r.reason}
                    </span>
                    <div className="flex gap-2">
                      <Button size="sm" onClick={() => handleRegularizationDecision(r.id, true)}>
                        Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleRegularizationDecision(r.id, false)}
                      >
                        Reject
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            </PanelSection>
          )}
        </Panel>

        {(leaveMessage || leaveError) && (
          <div>
            {leaveMessage && <p className="text-sm text-primary">{leaveMessage}</p>}
            {leaveError && <p className="text-sm text-destructive">{leaveError}</p>}
          </div>
        )}

        {/* Leave cluster: Apply Leave + My Leave Applications + whichever
            pending-approval views apply to this role, grouped as one panel. */}
        <Panel>
          <PanelSection>
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="flex size-9 items-center justify-center rounded-lg bg-muted">
                  <CalendarPlus className="size-5 text-muted-foreground" />
                </div>
                <div>
                  <div className="font-medium">Apply Leave</div>
                  <div className="text-sm text-muted-foreground">Click the button to apply for leave.</div>
                </div>
              </div>
              <Dialog open={applyDialogOpen} onOpenChange={setApplyDialogOpen}>
                <DialogTrigger render={<Button>+ Apply Leave</Button>} />
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Apply Leave</DialogTitle>
                  </DialogHeader>
                  <div className="flex flex-col gap-3">
                    <div className="flex flex-col gap-1">
                      <Label>Leave type</Label>
                      <Select value={leaveTypeId} onValueChange={setLeaveTypeId}>
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Select">
                            {(value: string) => {
                              const lt = leaveTypes.find((t) => t.id === value)
                              return lt ? leaveTypeLabel(lt) : 'Select'
                            }}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          {leaveTypes.map((lt) => (
                            <SelectItem key={lt.id} value={lt.id}>
                              {leaveTypeLabel(lt)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex flex-col gap-1">
                      <Label>Duration</Label>
                      <Select value={duration} onValueChange={(v) => setDuration(v as 'FULL_DAY' | 'HALF_DAY')}>
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="FULL_DAY">Full Day</SelectItem>
                          <SelectItem value="HALF_DAY">Half Day</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex flex-col gap-1">
                      <Label>{duration === 'HALF_DAY' ? 'Date' : 'From date'}</Label>
                      <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
                    </div>
                    {duration === 'FULL_DAY' && (
                      <div className="flex flex-col gap-1">
                        <Label>To date</Label>
                        <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
                      </div>
                    )}
                    <div className="flex flex-col gap-1">
                      <Label>Reason</Label>
                      <Input value={reason} onChange={(e) => setReason(e.target.value)} />
                    </div>
                  </div>
                  <DialogFooter>
                    <DialogClose render={<Button variant="outline">Cancel</Button>} />
                    <Button onClick={handleApplyLeave} disabled={!leaveTypeId || !startDate}>
                      Apply Leave
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
          </PanelSection>

          {showLeaveHistory && (
          <PanelSection>
            <h2 id="my-leave-applications" className="mb-2 font-medium">My Leave Applications</h2>
            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Leave Type</TableHead>
                    <TableHead>From</TableHead>
                    <TableHead>To</TableHead>
                    <TableHead>Duration</TableHead>
                    <TableHead>Reason</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Applied On</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {myApps.map((a) => (
                    <TableRow key={a.id}>
                      <TableCell>{a.leaveType?.name ?? leaveTypes.find((t) => t.id === a.leaveTypeId)?.name ?? '—'}</TableCell>
                      <TableCell>{a.startDate.slice(0, 10)}</TableCell>
                      <TableCell>{a.endDate.slice(0, 10)}</TableCell>
                      <TableCell>{isHalfDayApplication(a) ? 'Half Day' : 'Full Day'}</TableCell>
                      <TableCell>{a.reason ?? '—'}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{a.status}</Badge>
                      </TableCell>
                      <TableCell>{a.createdAt.slice(0, 10)}</TableCell>
                      <TableCell>
                        {a.status === 'APPROVED' && (
                          <Button size="sm" variant="outline" onClick={() => handleCancel(a.id)}>
                            Cancel
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                  {myApps.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center text-muted-foreground">
                        No applications yet.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </PanelSection>
          )}

          {pendingApprovalsList.length > 0 && (
            <PanelSection>
              <h2 className="mb-2 font-medium">Pending Approvals (You are an approver)</h2>
              <div className="overflow-x-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Employee</TableHead>
                      <TableHead>Leave Type</TableHead>
                      <TableHead>From</TableHead>
                      <TableHead>To</TableHead>
                      <TableHead>Duration</TableHead>
                      <TableHead>Reason</TableHead>
                      <TableHead>Applied On</TableHead>
                      <TableHead>Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pendingApprovalsList.map((a) => (
                      <TableRow key={a.id}>
                        <TableCell>
                          {a.employee?.firstName} {a.employee?.lastName}
                        </TableCell>
                        <TableCell>{a.leaveType?.name ?? '—'}</TableCell>
                        <TableCell>{a.startDate.slice(0, 10)}</TableCell>
                        <TableCell>{a.endDate.slice(0, 10)}</TableCell>
                        <TableCell>{isHalfDayApplication(a) ? 'Half Day' : 'Full Day'}</TableCell>
                        <TableCell>{a.reason ?? '—'}</TableCell>
                        <TableCell>{a.createdAt.slice(0, 10)}</TableCell>
                        <TableCell className="flex gap-2">
                          <Button
                            size="sm"
                            disabled={decidingId === a.id}
                            onClick={() => handleLeaveDecision(a.id, true)}
                          >
                            Approve
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={decidingId === a.id}
                            onClick={() => handleLeaveDecision(a.id, false)}
                          >
                            Reject
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </PanelSection>
          )}

          {isSuperAdmin && (
            <PanelSection>
              <h2 className="mb-2 font-medium">Pending Leave Requests (Company-wide)</h2>
              <div className="overflow-x-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Employee</TableHead>
                      <TableHead>Leave Type</TableHead>
                      <TableHead>From</TableHead>
                      <TableHead>To</TableHead>
                      <TableHead>Duration</TableHead>
                      <TableHead>Reason</TableHead>
                      <TableHead>Applied On</TableHead>
                      <TableHead>Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {companyPending.map((a) => (
                      <TableRow key={a.id}>
                        <TableCell>
                          {a.employee?.firstName} {a.employee?.lastName}
                        </TableCell>
                        <TableCell>{a.leaveType?.name ?? '—'}</TableCell>
                        <TableCell>{a.startDate.slice(0, 10)}</TableCell>
                        <TableCell>{a.endDate.slice(0, 10)}</TableCell>
                        <TableCell>{isHalfDayApplication(a) ? 'Half Day' : 'Full Day'}</TableCell>
                        <TableCell>{a.reason ?? '—'}</TableCell>
                        <TableCell>{a.createdAt.slice(0, 10)}</TableCell>
                        <TableCell className="flex gap-2">
                          <Button
                            size="sm"
                            disabled={decidingId === a.id}
                            onClick={() => handleLeaveDecision(a.id, true)}
                          >
                            Approve
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            disabled={decidingId === a.id}
                            onClick={() => handleLeaveDecision(a.id, false)}
                          >
                            Reject
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                    {companyPending.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={8} className="text-center text-muted-foreground">
                          No pending leave requests.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </PanelSection>
          )}
        </Panel>

        {isHrAdmin && (
          <Panel>
            <PanelSection>
              <h2 className="mb-2 font-medium">Create Leave Type (HR Admin)</h2>
              <div className="flex flex-wrap items-end gap-2">
                <div className="flex flex-col gap-1">
                  <Label>Name</Label>
                  <Input value={newTypeName} onChange={(e) => setNewTypeName(e.target.value)} />
                </div>
                <div className="flex flex-col gap-1">
                  <Label>Code</Label>
                  <Input
                    className="w-20"
                    placeholder="EL"
                    value={newTypeCode}
                    onChange={(e) => setNewTypeCode(e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <Label>Accrual frequency</Label>
                  <Select
                    value={newTypeFrequency}
                    onValueChange={(v) => setNewTypeFrequency(v as typeof newTypeFrequency)}
                  >
                    <SelectTrigger className="w-36">
                      <SelectValue placeholder="Frequency">
                        {(value: string) => value.charAt(0) + value.slice(1).toLowerCase()}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="MONTHLY">Monthly</SelectItem>
                      <SelectItem value="QUARTERLY">Quarterly</SelectItem>
                      <SelectItem value="ANNUAL">Annual</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col gap-1">
                  <Label>Accrual rate</Label>
                  <Input
                    className="w-20"
                    type="number"
                    value={newTypeRate}
                    onChange={(e) => setNewTypeRate(e.target.value)}
                  />
                </div>
                <Button variant="outline" onClick={handleCreateType}>
                  Create
                </Button>
              </div>
            </PanelSection>
          </Panel>
        )}

        {/* Biometric Attendance: kept at the very bottom — an infrequent
            HR/Admin tool, not part of the daily employee flow above. Still
            calls the exact same importBiometric(rows)/lockMonth() APIs —
            only the input affordance changed from a raw textarea to a
            drop-zone that reads the chosen/dropped file's text into the
            same importRaw state. */}
        {isHrAdmin && (
          <Panel>
            <PanelSection>
              <h2 className="mb-3 font-medium">Biometric Attendance</h2>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
                <div
                  className={`flex flex-1 cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed p-6 text-center transition-colors ${
                    dragOver ? 'border-primary bg-muted/50' : 'border-border'
                  }`}
                  onClick={() => fileInputRef.current?.click()}
                  onDragOver={(e) => {
                    e.preventDefault()
                    setDragOver(true)
                  }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={(e) => {
                    e.preventDefault()
                    setDragOver(false)
                    const file = e.dataTransfer.files?.[0]
                    if (file) loadFileIntoImportRaw(file)
                  }}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".json,application/json"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0]
                      if (file) loadFileIntoImportRaw(file)
                    }}
                  />
                  <Upload className="mb-1 size-5 text-muted-foreground" />
                  <div className="font-medium">Upload Biometric File</div>
                  <div className="text-xs text-muted-foreground">
                    Drag &amp; drop your file here, or click to browse (JSON)
                  </div>
                  {importFileName && (
                    <div className="mt-1 text-xs text-foreground">Selected: {importFileName}</div>
                  )}
                </div>
                <div className="flex flex-col gap-2 sm:w-40">
                  <Button variant="outline" onClick={handleImport} disabled={!importRaw}>
                    Import
                  </Button>
                  <Button variant="outline" onClick={handleLock}>
                    Lock {month}/{year}
                  </Button>
                  <a
                    href={sampleHref}
                    download="biometric-sample.json"
                    className="text-center text-xs text-muted-foreground underline underline-offset-2"
                  >
                    Download Sample
                  </a>
                </div>
              </div>
              {importResult && <p className="mt-2 text-sm">{importResult}</p>}
            </PanelSection>
          </Panel>
        )}
      </div>

      {/* Right sidebar — visually separate from the main content, per the
          reference design. Same balance data/fields as before, restyled as
          one compact card per leave type. */}
      <aside className="w-full shrink-0 lg:w-80 lg:sticky lg:top-6">
        <div className="rounded-xl bg-card p-4 ring-1 ring-foreground/10">
          <h2 className="mb-3 font-medium">Your Leave Balance</h2>
          <div className="flex flex-col gap-3">
            {balances.map((b) => {
              // This task: "Accrued" alone on the default card was
              // confusing (it looked like the total, not one component of
              // it). The default view now shows only Available/Used —
              // Opening/Accrued/Carry Forward move into an expandable
              // "Details" area. Same balance fields, no calculation
              // changed.
              const expanded = expandedBalances.has(b.leaveType.id)
              return (
                <div key={b.leaveType.id} className="rounded-lg border p-3 text-sm">
                  <div className="mb-2 font-semibold">{leaveTypeLabel(b.leaveType)}</div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <div className="text-xs text-muted-foreground">Available</div>
                      <div className="text-lg font-semibold">{b.available}</div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">Used</div>
                      <div className="text-lg font-semibold">{b.balance.used}</div>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="mt-2 text-xs text-primary underline underline-offset-2"
                    onClick={() => toggleBalanceDetails(b.leaveType.id)}
                  >
                    {expanded ? 'Hide details' : 'Details'}
                  </button>
                  {expanded && (
                    <div className="mt-2 grid grid-cols-2 gap-2 border-t pt-2 text-xs text-muted-foreground">
                      <div>Opening: {b.balance.openingBalance}</div>
                      <div>Accrued: {b.balance.accrued}</div>
                      <div>Carry Forward: {b.balance.carriedForward}</div>
                      <div>Used: {b.balance.used}</div>
                    </div>
                  )}
                </div>
              )
            })}
            {balances.length === 0 && <p className="text-sm text-muted-foreground">No leave types configured yet.</p>}
          </div>
          <Button
            variant="outline"
            className="mt-4 w-full"
            onClick={() => setShowLeaveHistory((prev) => !prev)}
          >
            {showLeaveHistory ? 'Hide Leaves Taken' : 'View Leaves Taken'}
          </Button>
        </div>
      </aside>
    </div>
  )
}

function SummaryStat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-md bg-muted px-3 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
    </div>
  )
}
