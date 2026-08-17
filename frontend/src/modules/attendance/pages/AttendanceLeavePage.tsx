import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ChevronLeft, ChevronRight, Pencil, Upload, CalendarPlus, Clock } from 'lucide-react'
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
  importBiometricFromFile,
  downloadBiometricImportTemplate,
  pendingOvertimeForMe,
  pendingSuperAdminOvertime,
  decideOvertimeClaim,
  listAllOvertimeClaims,
  addOvertimeComment,
  listOvertimeComments,
  lockMonth,
  ATTENDANCE_STATUS_COLOR,
  formatDuration,
  formatTime,
  type CalendarDay,
  type CalendarDayStatus,
  type RegularizationRequest,
  type OvertimeClaim,
  type RequestComment as AttendanceRequestComment,
} from '../api'
import { RegularizeDialog } from '../components/RegularizeDialog'
import { OvertimeClaimDialog } from '../components/OvertimeClaimDialog'
import {
  listLeaveTypes,
  createLeaveType,
  getBalances,
  applyLeave,
  decideLeave,
  cancelLeave,
  myApplications,
  pendingApprovals,
  isHalfDayApplication,
  pendingCompOffForMe,
  decideCompOff,
  listAllCompOffRequests,
  addCompOffComment,
  listCompOffComments,
  type LeaveType,
  type LeaveBalanceEntry,
  type LeaveApplication,
  type CompOffRequest,
  type RequestComment,
} from '@/modules/leave/api'
import { getDashboard, type Dashboard } from '@/modules/analytics/api'

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
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

// Appends the Holiday Calendar entry's name to the HOLIDAY badge — e.g.
// "HOLIDAY — Independence Day" — so the same day-status badge carries which
// holiday it is, without a second label/lookup.
function dayStatusLabel(d: { status: CalendarDayStatus; holidayName: string | null }): string {
  const label = statusLabel(d.status)
  return d.status === 'HOLIDAY' && d.holidayName ? `${label} — ${d.holidayName}` : label
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
  const [pendingOvertime, setPendingOvertime] = useState<OvertimeClaim[]>([])
  const [pendingSuperAdminOT, setPendingSuperAdminOT] = useState<OvertimeClaim[]>([])
  const [allOvertime, setAllOvertime] = useState<OvertimeClaim[]>([])
  const [overtimeComments, setOvertimeComments] = useState<Record<string, AttendanceRequestComment[]>>({})
  const [newOvertimeComment, setNewOvertimeComment] = useState<Record<string, string>>({})

  const [importRaw, setImportRaw] = useState('')
  const [importFile, setImportFile] = useState<File | null>(null)
  const [importFileName, setImportFileName] = useState<string | null>(null)
  const [importResult, setImportResult] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [leaveTypes, setLeaveTypes] = useState<LeaveType[]>([])
  const [balances, setBalances] = useState<LeaveBalanceEntry[]>([])
  const [myApps, setMyApps] = useState<LeaveApplication[]>([])
  const [pendingApprovalsList, setPendingApprovalsList] = useState<LeaveApplication[]>([])
  const [dashboard, setDashboard] = useState<Dashboard | null>(null)

  const [pendingCompOff, setPendingCompOff] = useState<CompOffRequest[]>([])
  const [allCompOff, setAllCompOff] = useState<CompOffRequest[]>([])
  const [compOffComments, setCompOffComments] = useState<Record<string, RequestComment[]>>({})
  const [newCompOffComment, setNewCompOffComment] = useState<Record<string, string>>({})

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

  function loadPendingOvertime() {
    if (!user) return
    pendingOvertimeForMe(user.id).then(setPendingOvertime).catch(() => setPendingOvertime([]))
    if (isSuperAdmin) {
      listAllOvertimeClaims().then(setAllOvertime).catch(() => setAllOvertime([]))
      pendingSuperAdminOvertime().then(setPendingSuperAdminOT).catch(() => setPendingSuperAdminOT([]))
    }
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
      pendingCompOffForMe().then(setPendingCompOff).catch(() => setPendingCompOff([])),
    ]
    if (isSuperAdmin) {
      tasks.push(getDashboard().then(setDashboard).catch(() => setDashboard(null)))
      tasks.push(listAllCompOffRequests().then(setAllCompOff).catch(() => setAllCompOff([])))
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
    loadPendingOvertime()
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

  async function handleOvertimeDecision(id: string, approve: boolean) {
    await decideOvertimeClaim(id, approve)
    setPendingOvertime((p) => p.filter((c) => c.id !== id))
    setPendingSuperAdminOT((p) => p.filter((c) => c.id !== id))
    loadPendingOvertime()
  }

  async function loadOvertimeComments(id: string) {
    try {
      const comments = await listOvertimeComments(id)
      setOvertimeComments((prev) => ({ ...prev, [id]: comments }))
    } catch {
      // Not the assigned approver/privileged — nothing to show.
    }
  }

  async function handleAddOvertimeComment(id: string) {
    const body = newOvertimeComment[id]
    if (!body) return
    try {
      await addOvertimeComment(id, body)
      setNewOvertimeComment((prev) => ({ ...prev, [id]: '' }))
      loadOvertimeComments(id)
    } catch (err) {
      setAttError(err instanceof ApiError ? err.message : 'Failed to add comment')
    }
  }

  function loadImportFile(file: File) {
    setImportFile(file)
    setImportFileName(file.name)
    setImportResult(null)
    if (file.name.toLowerCase().endsWith('.xlsx')) {
      setImportRaw('')
      return
    }
    const reader = new FileReader()
    reader.onload = () => setImportRaw(String(reader.result ?? ''))
    reader.readAsText(file)
  }

  async function handleImport() {
    setAttError(null)
    try {
      const res =
        importFile && importFile.name.toLowerCase().endsWith('.xlsx')
          ? await importBiometricFromFile(importFile)
          : await importBiometric(JSON.parse(importRaw || '[]'))
      setImportResult(
        `${res.matchedCount}/${res.totalRows} matched. Unmatched: ${
          res.unmatched.map((u) => u.employeeCode).join(', ') || 'none'
        }`,
      )
    } catch (err) {
      setAttError(err instanceof ApiError ? err.message : err instanceof Error ? err.message : 'Import failed')
    }
  }

  async function handleDownloadSample() {
    setAttError(null)
    try {
      await downloadBiometricImportTemplate()
    } catch (err) {
      setAttError(err instanceof ApiError ? err.message : 'Failed to download sample')
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

  async function handleCompOffDecision(id: string, approve: boolean) {
    setDecidingId(id)
    setLeaveError(null)
    setLeaveMessage(null)
    try {
      await decideCompOff(id, approve)
      await loadLeave()
      setLeaveMessage(approve ? 'Comp-off request approved.' : 'Comp-off request rejected.')
    } catch (err) {
      setLeaveError(err instanceof ApiError ? err.message : 'Failed to record decision')
    } finally {
      setDecidingId(null)
    }
  }

  async function loadCompOffComments(id: string) {
    try {
      const comments = await listCompOffComments(id)
      setCompOffComments((prev) => ({ ...prev, [id]: comments }))
    } catch {
      // Not the assigned approver/privileged — nothing to show.
    }
  }

  async function handleAddCompOffComment(id: string) {
    const body = newCompOffComment[id]
    if (!body) return
    try {
      await addCompOffComment(id, body)
      setNewCompOffComment((prev) => ({ ...prev, [id]: '' }))
      loadCompOffComments(id)
    } catch (err) {
      setLeaveError(err instanceof ApiError ? err.message : 'Failed to add comment')
    }
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
                  {dayStatusLabel(todayEntry)}
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
                            {dayStatusLabel(d)}
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
                        <TableCell className="flex gap-1">
                          {!isFutureDay && (
                            <>
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
                              <OvertimeClaimDialog
                                date={d.date}
                                currentOvertimeHours={null}
                                onSubmitted={loadPendingOvertime}
                                trigger={
                                  <Button size="icon-sm" variant="ghost" aria-label="Claim overtime">
                                    <Clock />
                                  </Button>
                                }
                              />
                            </>
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

          {pendingOvertime.length > 0 && (
            <PanelSection>
              <h2 className="mb-2 font-medium">Pending OT Claims to Decide (Manager)</h2>
              <ul className="flex flex-col gap-3 text-sm">
                {pendingOvertime.map((c) => (
                  <li key={c.id} className="rounded-md border p-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="font-medium">
                          {c.employee ? `${c.employee.firstName} ${c.employee.lastName}` : c.employeeId}
                        </div>
                        <div className="text-muted-foreground">
                          {c.date.slice(0, 10)} — {c.hoursClaimed}h: {c.reason}
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <Button size="sm" onClick={() => handleOvertimeDecision(c.id, true)}>
                          Approve
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => handleOvertimeDecision(c.id, false)}>
                          Reject
                        </Button>
                      </div>
                    </div>
                    {overtimeComments[c.id] === undefined ? (
                      <Button
                        className="mt-2 h-auto p-0 text-xs"
                        variant="ghost"
                        size="sm"
                        onClick={() => loadOvertimeComments(c.id)}
                      >
                        Show Super Admin comments
                      </Button>
                    ) : (
                      <ul className="mt-2 flex flex-col gap-1 border-t pt-2 text-xs text-muted-foreground">
                        {overtimeComments[c.id].map((cm) => (
                          <li key={cm.id}>{cm.body}</li>
                        ))}
                        {overtimeComments[c.id].length === 0 && <li>No comments yet.</li>}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            </PanelSection>
          )}

          {isSuperAdmin && pendingSuperAdminOT.length > 0 && (
            <PanelSection>
              <h2 className="mb-2 font-medium">Pending OT Claims — Final Approval (Super Admin)</h2>
              <ul className="flex flex-col gap-3 text-sm">
                {pendingSuperAdminOT.map((c) => (
                  <li key={c.id} className="rounded-md border p-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="font-medium">
                          {c.employee ? `${c.employee.firstName} ${c.employee.lastName}` : c.employeeId}
                        </div>
                        <div className="text-muted-foreground">
                          {c.date.slice(0, 10)} — {c.hoursClaimed}h: {c.reason} (manager-approved)
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <Button size="sm" onClick={() => handleOvertimeDecision(c.id, true)}>
                          Approve
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => handleOvertimeDecision(c.id, false)}>
                          Reject
                        </Button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </PanelSection>
          )}
        </Panel>

        {isSuperAdmin && (
          <Panel>
            <PanelSection>
              <h2 className="mb-2 font-medium">All OT Claims (Super Admin)</h2>
              <ul className="flex flex-col gap-3 text-sm">
                {allOvertime.map((c) => (
                  <li key={c.id} className="rounded-md border p-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="font-medium">
                          {c.employee ? `${c.employee.firstName} ${c.employee.lastName}` : c.employeeId}
                        </div>
                        <div className="text-muted-foreground">
                          {c.date.slice(0, 10)} — {c.hoursClaimed}h: {c.reason}
                        </div>
                      </div>
                      <Badge
                        variant={
                          c.status === 'APPROVED' ? 'default' : c.status === 'REJECTED' ? 'destructive' : 'outline'
                        }
                      >
                        {c.status}
                      </Badge>
                    </div>
                    <div className="mt-2 flex gap-2 border-t pt-2">
                      <Input
                        className="h-8 text-xs"
                        placeholder="Comment for the manager…"
                        value={newOvertimeComment[c.id] ?? ''}
                        onChange={(e) =>
                          setNewOvertimeComment((prev) => ({ ...prev, [c.id]: e.target.value }))
                        }
                      />
                      <Button size="sm" variant="outline" onClick={() => handleAddOvertimeComment(c.id)}>
                        Add Comment
                      </Button>
                    </div>
                  </li>
                ))}
                {allOvertime.length === 0 && <p className="text-muted-foreground">No claims yet.</p>}
              </ul>
            </PanelSection>
          </Panel>
        )}

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

          {pendingCompOff.length > 0 && (
            <PanelSection>
              <h2 className="mb-2 font-medium">Pending Comp-Off Requests to Decide</h2>
              <ul className="flex flex-col gap-3 text-sm">
                {pendingCompOff.map((r) => (
                  <li key={r.id} className="rounded-md border p-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="font-medium">
                          {r.employee ? `${r.employee.firstName} ${r.employee.lastName}` : r.employeeId}
                        </div>
                        <div className="text-muted-foreground">
                          Worked {r.workedDate.slice(0, 10)} — {r.reason}
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          disabled={decidingId === r.id}
                          onClick={() => handleCompOffDecision(r.id, true)}
                        >
                          Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={decidingId === r.id}
                          onClick={() => handleCompOffDecision(r.id, false)}
                        >
                          Reject
                        </Button>
                      </div>
                    </div>
                    {compOffComments[r.id] === undefined ? (
                      <Button
                        className="mt-2 h-auto p-0 text-xs"
                        variant="ghost"
                        size="sm"
                        onClick={() => loadCompOffComments(r.id)}
                      >
                        Show Super Admin comments
                      </Button>
                    ) : (
                      <ul className="mt-2 flex flex-col gap-1 border-t pt-2 text-xs text-muted-foreground">
                        {compOffComments[r.id].map((c) => (
                          <li key={c.id}>{c.body}</li>
                        ))}
                        {compOffComments[r.id].length === 0 && <li>No comments yet.</li>}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            </PanelSection>
          )}

        </Panel>

        {isSuperAdmin && (
          <Panel>
            <PanelSection>
              <h2 className="mb-2 font-medium">All Comp-Off Requests (Super Admin)</h2>
              <ul className="flex flex-col gap-3 text-sm">
                {allCompOff.map((r) => (
                  <li key={r.id} className="rounded-md border p-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="font-medium">
                          {r.employee ? `${r.employee.firstName} ${r.employee.lastName}` : r.employeeId}
                        </div>
                        <div className="text-muted-foreground">
                          Worked {r.workedDate.slice(0, 10)} — {r.reason}
                        </div>
                      </div>
                      <Badge
                        variant={
                          r.status === 'APPROVED' ? 'default' : r.status === 'REJECTED' ? 'destructive' : 'outline'
                        }
                      >
                        {r.status}
                      </Badge>
                    </div>
                    <div className="mt-2 flex gap-2 border-t pt-2">
                      <Input
                        className="h-8 text-xs"
                        placeholder="Comment for the manager…"
                        value={newCompOffComment[r.id] ?? ''}
                        onChange={(e) =>
                          setNewCompOffComment((prev) => ({ ...prev, [r.id]: e.target.value }))
                        }
                      />
                      <Button size="sm" variant="outline" onClick={() => handleAddCompOffComment(r.id)}>
                        Add Comment
                      </Button>
                    </div>
                  </li>
                ))}
                {allCompOff.length === 0 && <p className="text-muted-foreground">No requests yet.</p>}
              </ul>
            </PanelSection>
          </Panel>
        )}

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
            calls the exact same importBiometric(rows)/lockMonth() APIs for a
            JSON file — an .xlsx file instead goes straight to the multipart
            importBiometricFromFile() upload, matching the sample workbook
            Download Sample now produces. */}
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
                    if (file) loadImportFile(file)
                  }}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,.json,application/json"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0]
                      if (file) loadImportFile(file)
                    }}
                  />
                  <Upload className="mb-1 size-5 text-muted-foreground" />
                  <div className="font-medium">Upload Biometric File</div>
                  <div className="text-xs text-muted-foreground">
                    Drag &amp; drop your file here, or click to browse (Excel or JSON)
                  </div>
                  {importFileName && (
                    <div className="mt-1 text-xs text-foreground">Selected: {importFileName}</div>
                  )}
                </div>
                <div className="flex flex-col gap-2 sm:w-40">
                  <Button variant="outline" onClick={handleImport} disabled={!importFile}>
                    Import
                  </Button>
                  <Button variant="outline" onClick={handleLock}>
                    Lock {month}/{year}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleDownloadSample}
                    className="h-auto p-0 text-xs font-normal text-muted-foreground underline underline-offset-2"
                  >
                    Download Sample
                  </Button>
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
