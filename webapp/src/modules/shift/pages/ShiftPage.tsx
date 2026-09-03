"use client"

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
import { getReferenceData, type ManagerOption } from '@/modules/employee/api'
import {
  listShifts,
  createShift,
  assignRoster,
  getRoster,
  getHybridSchedule,
  setHybridSchedule,
  myWfoWfhRequests,
  pendingWfoWfhRequestsForMe,
  pendingWfoWfhManagerStageForVisibility,
  pendingWfoWfhFinalApproval,
  decideWfoWfhRequest,
  listAllWfoWfhRequests,
  addWfoWfhComment,
  listWfoWfhComments,
  type Shift,
  type RosterEntry,
  type WfoWfhRequest,
  type WfoWfhComment,
} from '../api'
import { BulkWfoUploadDialog } from '../components/BulkWfoUploadDialog'
import { WfoWfhRequestDialog } from '../components/WfoWfhRequestDialog'

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export function ShiftPage() {
  const { user } = useAuth()
  // General HR access — mirrors HR_ADMIN except decision authority, which
  // HR Associate never gets; canApprove (below) gates the WFO/WFH final
  // Approve/Reject buttons specifically.
  const isHrAdmin = user?.role === 'HR_ADMIN' || user?.role === 'SUPER_ADMIN' || user?.role === 'HR_ASSOCIATE'
  const isSuperAdmin = user?.role === 'SUPER_ADMIN'
  const canApprove = user?.role === 'HR_ADMIN' || user?.role === 'SUPER_ADMIN'

  const [shifts, setShifts] = useState<Shift[]>([])
  const [myRoster, setMyRoster] = useState<RosterEntry[]>([])
  const [employees, setEmployees] = useState<ManagerOption[]>([])

  const [myWfoWfh, setMyWfoWfh] = useState<WfoWfhRequest[]>([])
  const [pendingWfoWfh, setPendingWfoWfh] = useState<WfoWfhRequest[]>([])
  const [managerStageVisibility, setManagerStageVisibility] = useState<WfoWfhRequest[]>([])
  const [pendingFinalApproval, setPendingFinalApproval] = useState<WfoWfhRequest[]>([])
  const [allWfoWfh, setAllWfoWfh] = useState<WfoWfhRequest[]>([])
  const [wfoWfhComments, setWfoWfhComments] = useState<Record<string, WfoWfhComment[]>>({})
  const [newCommentBody, setNewCommentBody] = useState<Record<string, string>>({})

  const [newShiftName, setNewShiftName] = useState('')
  const [newShiftStart, setNewShiftStart] = useState('10:00')
  const [newShiftEnd, setNewShiftEnd] = useState('19:00')

  const [assignEmployeeId, setAssignEmployeeId] = useState('')
  const [assignDates, setAssignDates] = useState('')
  const [assignShiftId, setAssignShiftId] = useState('')
  const [assignWorkMode, setAssignWorkMode] = useState<'AUTO' | 'OFFICE' | 'WORK_FROM_HOME'>('AUTO')

  const [wfoEmployeeId, setWfoEmployeeId] = useState('')
  const [wfoMonth, setWfoMonth] = useState(() => new Date().toISOString().slice(0, 7))
  const [wfoWeekdays, setWfoWeekdays] = useState<number[]>([])

  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Each guards a single in-flight mutation so a slow response can't be
  // double-fired by a second click.
  const [creatingShift, setCreatingShift] = useState(false)
  const [assigning, setAssigning] = useState(false)
  const [savingWfoSchedule, setSavingWfoSchedule] = useState(false)
  const [deciding, setDeciding] = useState<{ id: string; approve: boolean } | null>(null)
  const [commentingId, setCommentingId] = useState<string | null>(null)

  function refresh() {
    listShifts().then(setShifts).catch(() => setShifts([]))
    getReferenceData().then((r) => setEmployees(r.managers)).catch(() => setEmployees([]))
    if (user) {
      const from = new Date()
      const to = new Date()
      to.setDate(to.getDate() + 30)
      getRoster(user.id, from.toISOString().slice(0, 10), to.toISOString().slice(0, 10))
        .then(setMyRoster)
        .catch(() => setMyRoster([]))
    }
    myWfoWfhRequests().then(setMyWfoWfh).catch(() => setMyWfoWfh([]))
    pendingWfoWfhRequestsForMe().then(setPendingWfoWfh).catch(() => setPendingWfoWfh([]))
    if (isHrAdmin) {
      pendingWfoWfhManagerStageForVisibility()
        .then(setManagerStageVisibility)
        .catch(() => setManagerStageVisibility([]))
      pendingWfoWfhFinalApproval().then(setPendingFinalApproval).catch(() => setPendingFinalApproval([]))
    }
    if (isSuperAdmin) {
      listAllWfoWfhRequests().then(setAllWfoWfh).catch(() => setAllWfoWfh([]))
    }
  }

  useEffect(() => {
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id])

  useEffect(() => {
    if (!wfoEmployeeId || !wfoMonth) {
      setWfoWeekdays([])
      return
    }
    const [year, month] = wfoMonth.split('-').map(Number)
    getHybridSchedule(wfoEmployeeId, year, month)
      .then((s) => setWfoWeekdays(s.officeWeekdays))
      .catch(() => setWfoWeekdays([]))
  }, [wfoEmployeeId, wfoMonth])

  async function handleCreateShift() {
    if (creatingShift) return
    setError(null)
    setCreatingShift(true)
    try {
      await createShift({ name: newShiftName, startTime: newShiftStart, endTime: newShiftEnd })
      setNewShiftName('')
      refresh()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create shift')
    } finally {
      setCreatingShift(false)
    }
  }

  async function handleAssign() {
    if (assigning) return
    setError(null)
    setMessage(null)
    setAssigning(true)
    try {
      const dates = assignDates.split(',').map((d) => d.trim()).filter(Boolean)
      const res = await assignRoster({
        employeeIds: [assignEmployeeId],
        dates,
        shiftId: assignShiftId || undefined,
        workMode: assignWorkMode === 'AUTO' ? undefined : assignWorkMode,
      })
      setMessage(`Assigned ${res.successCount}/${dates.length} date(s).`)
      setAssignDates('')
      refresh()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to assign roster')
    } finally {
      setAssigning(false)
    }
  }

  function toggleWfoDay(day: number) {
    setWfoWeekdays((days) =>
      days.includes(day) ? days.filter((d) => d !== day) : [...days, day].sort(),
    )
  }

  async function handleSaveWfoSchedule() {
    if (savingWfoSchedule) return
    setError(null)
    setMessage(null)
    setSavingWfoSchedule(true)
    try {
      const [year, month] = wfoMonth.split('-').map(Number)
      const res = await setHybridSchedule({
        employeeId: wfoEmployeeId,
        year,
        month,
        officeWeekdays: wfoWeekdays,
      })
      setMessage(`Updated ${res.daysUpdated} day(s) for this employee.`)
      refresh()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to update WFO days')
    } finally {
      setSavingWfoSchedule(false)
    }
  }

  async function handleWfoWfhDecision(id: string, approve: boolean) {
    if (deciding) return
    setError(null)
    setDeciding({ id, approve })
    try {
      await decideWfoWfhRequest(id, approve)
      setPendingWfoWfh((prev) => prev.filter((r) => r.id !== id))
      setPendingFinalApproval((prev) => prev.filter((r) => r.id !== id))
      refresh()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to record decision')
    } finally {
      setDeciding(null)
    }
  }

  async function loadWfoWfhComments(id: string) {
    try {
      const comments = await listWfoWfhComments(id)
      setWfoWfhComments((prev) => ({ ...prev, [id]: comments }))
    } catch {
      // Not the assigned approver/privileged — nothing to show.
    }
  }

  async function handleAddWfoWfhComment(id: string) {
    const body = newCommentBody[id]
    if (!body || commentingId) return
    setError(null)
    setCommentingId(id)
    try {
      await addWfoWfhComment(id, body)
      setNewCommentBody((prev) => ({ ...prev, [id]: '' }))
      loadWfoWfhComments(id)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to add comment')
    } finally {
      setCommentingId(null)
    }
  }

  function wfoWfhRequestLabel(r: WfoWfhRequest) {
    return `${r.originalDate.slice(0, 10)} → ${r.requestedWorkMode === 'WORK_FROM_HOME' ? 'WFH' : 'Office'} (comp: ${r.compensatoryDate.slice(0, 10)} → ${r.compensatoryWorkMode === 'WORK_FROM_HOME' ? 'WFH' : 'Office'})`
  }

  function wfoWfhStatusLabel(status: WfoWfhRequest['status']) {
    if (status === 'PENDING_MANAGER') return 'Pending Manager'
    if (status === 'PENDING_FINAL_APPROVAL') return 'Pending Final Approval'
    return status.charAt(0) + status.slice(1).toLowerCase()
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <h1 className="text-xl font-semibold">Shift &amp; Roster</h1>

      {message && <p className="text-sm text-primary">{message}</p>}
      {error && <p className="text-sm text-destructive">{error}</p>}

      <Card>
        <CardHeader>
          <CardTitle>My Roster (next 30 days)</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="flex flex-wrap gap-2 text-sm">
            {myRoster.map((r) => (
              <li key={r.id} className="rounded-md bg-muted px-2 py-1">
                {r.date.slice(0, 10)}: {r.isWeekOff ? 'Week Off' : r.shift?.name ?? 'Unassigned'}
                {!r.isWeekOff && (
                  <Badge className="ml-2" variant={r.workMode === 'WORK_FROM_HOME' ? 'outline' : 'default'}>
                    {r.workMode === 'WORK_FROM_HOME' ? 'WFH' : 'Office'}
                  </Badge>
                )}
              </li>
            ))}
            {myRoster.length === 0 && <p className="text-muted-foreground">No roster entries yet.</p>}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>WFO/WFH Change Requests</CardTitle>
            <WfoWfhRequestDialog onSubmitted={refresh} />
          </div>
        </CardHeader>
        <CardContent>
          <ul className="flex flex-col gap-2 text-sm">
            {myWfoWfh.map((r) => (
              <li key={r.id} className="flex items-center justify-between rounded-md bg-muted px-2 py-1">
                <span>
                  {wfoWfhRequestLabel(r)}
                  {r.approverName && <span className="text-muted-foreground"> — Manager: {r.approverName}</span>}
                </span>
                <Badge
                  variant={
                    r.status === 'APPROVED' ? 'default' : r.status === 'REJECTED' ? 'destructive' : 'outline'
                  }
                >
                  {wfoWfhStatusLabel(r.status)}
                </Badge>
              </li>
            ))}
            {myWfoWfh.length === 0 && <p className="text-muted-foreground">No requests yet.</p>}
          </ul>
        </CardContent>
      </Card>

      {pendingWfoWfh.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Pending WFO/WFH Requests to Decide (Manager)</CardTitle>
          </CardHeader>
          <CardContent>
          <ul className="flex flex-col gap-3 text-sm">
            {pendingWfoWfh.map((r) => (
              <li key={r.id} className="rounded-md border p-3">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium">
                      {r.employee ? `${r.employee.firstName} ${r.employee.lastName}` : r.employeeId}
                    </div>
                    <div className="text-muted-foreground">{wfoWfhRequestLabel(r)}</div>
                    <div className="text-muted-foreground">Reason: {r.reason}</div>
                    {r.approverName && <div className="text-muted-foreground">Manager: {r.approverName}</div>}
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="success"
                      disabled={deciding !== null}
                      onClick={() => handleWfoWfhDecision(r.id, true)}
                    >
                      {deciding?.id === r.id && deciding.approve ? 'Approving…' : 'Approve'}
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      disabled={deciding !== null}
                      onClick={() => handleWfoWfhDecision(r.id, false)}
                    >
                      {deciding?.id === r.id && !deciding.approve ? 'Rejecting…' : 'Reject'}
                    </Button>
                  </div>
                </div>
                {wfoWfhComments[r.id] === undefined ? (
                  <Button
                    className="mt-2 h-auto p-0 text-xs"
                    variant="ghost"
                    size="sm"
                    onClick={() => loadWfoWfhComments(r.id)}
                  >
                    Show Super Admin comments
                  </Button>
                ) : (
                  <ul className="mt-2 flex flex-col gap-1 border-t pt-2 text-xs text-muted-foreground">
                    {wfoWfhComments[r.id].map((c) => (
                      <li key={c.id}>{c.body}</li>
                    ))}
                    {wfoWfhComments[r.id].length === 0 && <li>No comments yet.</li>}
                  </ul>
                )}
              </li>
            ))}
          </ul>
          </CardContent>
        </Card>
      )}

      {/* Two-step WFO/WFH approval: this is the visibility-only view of
          requests still waiting on the manager — Super Admin/HR Admin were
          notified at submission, but there's nothing to act on here yet. */}
      {isHrAdmin && managerStageVisibility.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Awaiting Manager Approval (not yet actionable)</CardTitle>
          </CardHeader>
          <CardContent>
          <ul className="flex flex-col gap-2 text-sm">
            {managerStageVisibility.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-2 rounded-md bg-muted px-2 py-1">
                <span className="flex flex-wrap items-center justify-between gap-2 flex-1">
                  <span className="font-medium">
                    {r.employee ? `${r.employee.firstName} ${r.employee.lastName}` : r.employeeId}
                  </span>
                  <span className="text-muted-foreground">{wfoWfhRequestLabel(r)}</span>
                  {r.approverName && <span className="text-muted-foreground">Manager: {r.approverName}</span>}
                </span>
                <Badge variant="outline">Manager review pending</Badge>
              </li>
            ))}
          </ul>
          </CardContent>
        </Card>
      )}

      {/* Two-step WFO/WFH approval: final sign-off, actionable by either a
          Super Admin or an HR Admin once the manager has already approved. */}
      {isHrAdmin && pendingFinalApproval.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Pending Final Approval (Super Admin / HR Admin)</CardTitle>
          </CardHeader>
          <CardContent>
          <ul className="flex flex-col gap-3 text-sm">
            {pendingFinalApproval.map((r) => (
              <li key={r.id} className="rounded-md border p-3">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium">
                      {r.employee ? `${r.employee.firstName} ${r.employee.lastName}` : r.employeeId}
                    </div>
                    <div className="text-muted-foreground">{wfoWfhRequestLabel(r)}</div>
                    <div className="text-muted-foreground">Reason: {r.reason}</div>
                    <div className="text-muted-foreground">
                      Manager{r.approverName ? ` (${r.approverName})` : ""} already approved this request.
                    </div>
                  </div>
                  {canApprove && (
                    <div className="flex gap-2">
                      <Button size="sm" variant="success" onClick={() => handleWfoWfhDecision(r.id, true)}>
                        Approve
                      </Button>
                      <Button size="sm" variant="destructive" onClick={() => handleWfoWfhDecision(r.id, false)}>
                        Reject
                      </Button>
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
          </CardContent>
        </Card>
      )}

      {isSuperAdmin && (
        <Card>
          <CardHeader>
            <CardTitle>All WFO/WFH Requests (Super Admin)</CardTitle>
          </CardHeader>
          <CardContent>
          <ul className="flex flex-col gap-3 text-sm">
            {allWfoWfh.map((r) => (
              <li key={r.id} className="rounded-md border p-3">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium">
                      {r.employee ? `${r.employee.firstName} ${r.employee.lastName}` : r.employeeId}
                    </div>
                    <div className="text-muted-foreground">{wfoWfhRequestLabel(r)}</div>
                    {r.approverName && <div className="text-muted-foreground">Manager: {r.approverName}</div>}
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
                    value={newCommentBody[r.id] ?? ''}
                    onChange={(e) =>
                      setNewCommentBody((prev) => ({ ...prev, [r.id]: e.target.value }))
                    }
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={commentingId !== null}
                    onClick={() => handleAddWfoWfhComment(r.id)}
                  >
                    {commentingId === r.id ? 'Adding…' : 'Add Comment'}
                  </Button>
                </div>
              </li>
            ))}
            {allWfoWfh.length === 0 && <p className="text-muted-foreground">No requests yet.</p>}
          </ul>
          </CardContent>
        </Card>
      )}

      {isHrAdmin && (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Create Shift Template (HR Admin)</CardTitle>
            </CardHeader>
            <CardContent>
            <div className="flex flex-wrap items-end gap-2">
              <div className="flex flex-col gap-1">
                <Label>Name</Label>
                <Input value={newShiftName} onChange={(e) => setNewShiftName(e.target.value)} />
              </div>
              <div className="flex flex-col gap-1">
                <Label>Start</Label>
                <Input value={newShiftStart} onChange={(e) => setNewShiftStart(e.target.value)} />
              </div>
              <div className="flex flex-col gap-1">
                <Label>End</Label>
                <Input value={newShiftEnd} onChange={(e) => setNewShiftEnd(e.target.value)} />
              </div>
              <Button variant="outline" disabled={creatingShift} onClick={handleCreateShift}>
                {creatingShift ? 'Creating…' : 'Create'}
              </Button>
            </div>
            <ul className="mt-3 flex flex-wrap gap-2 text-sm">
              {shifts.map((s) => (
                <li key={s.id} className="rounded-md bg-muted px-2 py-1">
                  {s.name} ({s.startTime}–{s.endTime})
                </li>
              ))}
            </ul>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Assign Roster (HR Admin)</CardTitle>
            </CardHeader>
            <CardContent>
            <div className="flex flex-wrap items-end gap-2">
              <div className="flex flex-col gap-1">
                <Label>Employee</Label>
                <Select value={assignEmployeeId} onValueChange={(v) => setAssignEmployeeId(v ?? '')}>
                  <SelectTrigger className="w-56">
                    <SelectValue placeholder="Select employee">
                      {(value: string) => {
                        const e = employees.find((emp) => emp.id === value)
                        return e ? `${e.firstName} ${e.lastName}` : 'Select employee'
                      }}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {employees.map((e) => (
                      <SelectItem key={e.id} value={e.id}>
                        {e.firstName} {e.lastName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1">
                <Label>Shift</Label>
                <Select value={assignShiftId} onValueChange={(v) => setAssignShiftId(v ?? '')}>
                  <SelectTrigger className="w-40">
                    <SelectValue placeholder="Select shift">
                      {(value: string) =>
                        shifts.find((s) => s.id === value)?.name ?? 'Select shift'
                      }
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {shifts.length === 0 ? (
                      <div className="px-2 py-1.5 text-sm text-muted-foreground">
                        No shifts yet — create one above
                      </div>
                    ) : (
                      shifts.map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          {s.name}
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1">
                <Label>Work mode</Label>
                <Select
                  value={assignWorkMode}
                  onValueChange={(v) => setAssignWorkMode(v as typeof assignWorkMode)}
                >
                  <SelectTrigger className="w-36">
                    <SelectValue placeholder="Work mode">
                      {(value: string) =>
                        value === 'AUTO' ? "Don't change" : value === 'OFFICE' ? 'Office' : 'WFH'
                      }
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="AUTO">Don&apos;t change</SelectItem>
                    <SelectItem value="OFFICE">Office</SelectItem>
                    <SelectItem value="WORK_FROM_HOME">WFH</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1">
                <Label>Dates (comma-separated)</Label>
                <Input
                  className="w-64"
                  placeholder="2026-08-10, 2026-08-11"
                  value={assignDates}
                  onChange={(e) => setAssignDates(e.target.value)}
                />
              </div>
              <Button variant="outline" disabled={assigning} onClick={handleAssign}>
                {assigning ? 'Assigning…' : 'Assign'}
              </Button>
            </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Assign WFO Days (HR Admin)</CardTitle>
                <BulkWfoUploadDialog onImported={() => refresh()} />
              </div>
            </CardHeader>
            <CardContent>
            <p className="mb-2 text-sm text-muted-foreground">
              Employees follow a hybrid work culture, but office days aren&apos;t the same for
              everyone. Assign one employee at a time below, or use &quot;Bulk Upload WFO Days&quot; to set
              every employee&apos;s own office-weekday pattern for the month in one file. Every other
              working day is auto-marked WFH.
            </p>
            <div className="flex flex-wrap items-end gap-2">
              <div className="flex flex-col gap-1">
                <Label>Employee</Label>
                <Select value={wfoEmployeeId} onValueChange={(v) => setWfoEmployeeId(v ?? '')}>
                  <SelectTrigger className="w-56">
                    <SelectValue placeholder="Select employee">
                      {(value: string) => {
                        const e = employees.find((emp) => emp.id === value)
                        return e ? `${e.firstName} ${e.lastName}` : 'Select employee'
                      }}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {employees.map((e) => (
                      <SelectItem key={e.id} value={e.id}>
                        {e.firstName} {e.lastName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1">
                <Label>Month</Label>
                <Input
                  type="month"
                  className="w-40"
                  value={wfoMonth}
                  onChange={(e) => setWfoMonth(e.target.value)}
                />
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-3">
              {WEEKDAY_LABELS.map((label, day) => (
                <label key={day} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    disabled={!wfoEmployeeId}
                    checked={wfoWeekdays.includes(day)}
                    onChange={() => toggleWfoDay(day)}
                  />
                  {label}
                </label>
              ))}
            </div>
            <Button
              className="mt-3"
              variant="outline"
              disabled={!wfoEmployeeId || savingWfoSchedule}
              onClick={handleSaveWfoSchedule}
            >
              {savingWfoSchedule ? 'Saving…' : 'Save WFO Days'}
            </Button>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
