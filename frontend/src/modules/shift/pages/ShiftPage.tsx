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
import { useAuth } from '@/shared/auth/AuthContext'
import { ApiError } from '@/lib/api'
import { getReferenceData, type ManagerOption } from '@/modules/employee/api'
import {
  listShifts,
  createShift,
  assignRoster,
  getRoster,
  requestSwap,
  listSwaps,
  decideSwap,
  getHybridSchedule,
  setHybridSchedule,
  type Shift,
  type RosterEntry,
  type ShiftSwapRequest,
} from '../api'

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export function ShiftPage() {
  const { user } = useAuth()
  const isHrAdmin = user?.role === 'HR_ADMIN' || user?.role === 'SUPER_ADMIN'

  const [shifts, setShifts] = useState<Shift[]>([])
  const [myRoster, setMyRoster] = useState<RosterEntry[]>([])
  const [swaps, setSwaps] = useState<ShiftSwapRequest[]>([])
  const [employees, setEmployees] = useState<ManagerOption[]>([])

  const [newShiftName, setNewShiftName] = useState('')
  const [newShiftStart, setNewShiftStart] = useState('09:00')
  const [newShiftEnd, setNewShiftEnd] = useState('18:00')

  const [assignEmployeeId, setAssignEmployeeId] = useState('')
  const [assignDates, setAssignDates] = useState('')
  const [assignShiftId, setAssignShiftId] = useState('')
  const [assignWorkMode, setAssignWorkMode] = useState<'AUTO' | 'OFFICE' | 'WORK_FROM_HOME'>('AUTO')

  const [swapCounterpartId, setSwapCounterpartId] = useState('')
  const [swapDate, setSwapDate] = useState('')

  const [wfoEmployeeId, setWfoEmployeeId] = useState('')
  const [wfoMonth, setWfoMonth] = useState(() => new Date().toISOString().slice(0, 7))
  const [wfoWeekdays, setWfoWeekdays] = useState<number[]>([])

  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

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
      listSwaps({ approverId: user.id }).then(setSwaps).catch(() => setSwaps([]))
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
    setError(null)
    try {
      await createShift({ name: newShiftName, startTime: newShiftStart, endTime: newShiftEnd })
      setNewShiftName('')
      refresh()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create shift')
    }
  }

  async function handleAssign() {
    setError(null)
    setMessage(null)
    try {
      const dates = assignDates.split(',').map((d) => d.trim()).filter(Boolean)
      const res = await assignRoster({
        employeeIds: [assignEmployeeId],
        dates,
        shiftId: assignShiftId || undefined,
        workMode: assignWorkMode === 'AUTO' ? undefined : assignWorkMode,
      })
      setMessage(`Assigned ${res.successCount}/${dates.length} date(s).`)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to assign roster')
    }
  }

  function toggleWfoDay(day: number) {
    setWfoWeekdays((days) =>
      days.includes(day) ? days.filter((d) => d !== day) : [...days, day].sort(),
    )
  }

  async function handleSaveWfoSchedule() {
    setError(null)
    setMessage(null)
    try {
      const [year, month] = wfoMonth.split('-').map(Number)
      const res = await setHybridSchedule({
        employeeId: wfoEmployeeId,
        year,
        month,
        officeWeekdays: wfoWeekdays,
      })
      setMessage(`Updated ${res.daysUpdated} day(s) for this employee.`)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to update WFO days')
    }
  }

  async function handleRequestSwap() {
    setError(null)
    setMessage(null)
    try {
      await requestSwap({ counterpartId: swapCounterpartId, date: swapDate })
      setMessage('Swap request submitted.')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to request swap')
    }
  }

  async function handleDecideSwap(id: string, approve: boolean) {
    await decideSwap(id, approve)
    refresh()
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <h1 className="text-xl font-semibold">Shift &amp; Roster</h1>

      {message && <p className="text-sm text-primary">{message}</p>}
      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="rounded-md border p-4">
        <h2 className="mb-2 font-medium">My Roster (next 30 days)</h2>
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
      </div>

      <div className="rounded-md border p-4">
        <h2 className="mb-2 font-medium">Request Shift Swap</h2>
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex flex-col gap-1">
            <Label>Swap with</Label>
            <Select value={swapCounterpartId} onValueChange={setSwapCounterpartId}>
              <SelectTrigger className="w-56">
                <SelectValue placeholder="Select colleague">
                  {(value: string) => {
                    const e = employees.find((emp) => emp.id === value)
                    return e ? `${e.firstName} ${e.lastName}` : 'Select colleague'
                  }}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {employees
                  .filter((e) => e.id !== user?.id)
                  .map((e) => (
                    <SelectItem key={e.id} value={e.id}>
                      {e.firstName} {e.lastName}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <Label>Date</Label>
            <Input type="date" value={swapDate} onChange={(e) => setSwapDate(e.target.value)} />
          </div>
          <Button onClick={handleRequestSwap}>Request Swap</Button>
        </div>
      </div>

      {swaps.length > 0 && (
        <div className="rounded-md border p-4">
          <h2 className="mb-2 font-medium">Swap Requests to Decide</h2>
          <ul className="flex flex-col gap-2 text-sm">
            {swaps.map((s) => (
              <li key={s.id} className="flex items-center justify-between">
                <span>
                  {s.requester?.firstName} ↔ {s.counterpart?.firstName} on {s.date.slice(0, 10)}{' '}
                  <Badge variant="outline">{s.status}</Badge>
                </span>
                {s.status === 'PENDING' && (
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => handleDecideSwap(s.id, true)}>
                      Approve
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => handleDecideSwap(s.id, false)}>
                      Reject
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {isHrAdmin && (
        <>
          <div className="rounded-md border p-4">
            <h2 className="mb-2 font-medium">Create Shift Template (HR Admin)</h2>
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
              <Button variant="outline" onClick={handleCreateShift}>
                Create
              </Button>
            </div>
            <ul className="mt-3 flex flex-wrap gap-2 text-sm">
              {shifts.map((s) => (
                <li key={s.id} className="rounded-md bg-muted px-2 py-1">
                  {s.name} ({s.startTime}–{s.endTime})
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-md border p-4">
            <h2 className="mb-2 font-medium">Assign Roster (HR Admin)</h2>
            <div className="flex flex-wrap items-end gap-2">
              <div className="flex flex-col gap-1">
                <Label>Employee</Label>
                <Select value={assignEmployeeId} onValueChange={setAssignEmployeeId}>
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
                <Select value={assignShiftId} onValueChange={setAssignShiftId}>
                  <SelectTrigger className="w-40">
                    <SelectValue placeholder="Select shift">
                      {(value: string) =>
                        shifts.find((s) => s.id === value)?.name ?? 'Select shift'
                      }
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {shifts.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}
                      </SelectItem>
                    ))}
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
                    <SelectItem value="AUTO">Don't change</SelectItem>
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
              <Button variant="outline" onClick={handleAssign}>
                Assign
              </Button>
            </div>
          </div>

          <div className="rounded-md border p-4">
            <h2 className="mb-2 font-medium">Assign WFO Days (HR Admin)</h2>
            <p className="mb-2 text-sm text-muted-foreground">
              Employees follow a hybrid work culture, but office days aren't the same for
              everyone. Pick an employee and a month, then choose which weekdays are their
              office days that month — every other working day is auto-marked WFH.
            </p>
            <div className="flex flex-wrap items-end gap-2">
              <div className="flex flex-col gap-1">
                <Label>Employee</Label>
                <Select value={wfoEmployeeId} onValueChange={setWfoEmployeeId}>
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
              disabled={!wfoEmployeeId}
              onClick={handleSaveWfoSchedule}
            >
              Save WFO Days
            </Button>
          </div>
        </>
      )}
    </div>
  )
}
