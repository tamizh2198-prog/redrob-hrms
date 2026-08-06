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
import {
  listLeaveTypes,
  createLeaveType,
  getBalances,
  applyLeave,
  decideLeave,
  cancelLeave,
  myApplications,
  pendingApprovals,
  type LeaveType,
  type LeaveBalanceEntry,
  type LeaveApplication,
} from '../api'

export function LeavePage() {
  const { user } = useAuth()
  const isHrAdmin = user?.role === 'HR_ADMIN' || user?.role === 'SUPER_ADMIN'

  const [leaveTypes, setLeaveTypes] = useState<LeaveType[]>([])
  const [balances, setBalances] = useState<LeaveBalanceEntry[]>([])
  const [myApps, setMyApps] = useState<LeaveApplication[]>([])
  const [pending, setPending] = useState<LeaveApplication[]>([])

  const [leaveTypeId, setLeaveTypeId] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [reason, setReason] = useState('')

  const [newTypeName, setNewTypeName] = useState('')
  const [newTypeCode, setNewTypeCode] = useState('')
  const [newTypeFrequency, setNewTypeFrequency] = useState<'MONTHLY' | 'QUARTERLY' | 'ANNUAL'>('MONTHLY')
  const [newTypeRate, setNewTypeRate] = useState('1')

  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  function leaveTypeLabel(lt: LeaveType) {
    return lt.code ? `${lt.name} (${lt.code})` : lt.name
  }

  function refresh() {
    if (!user) return
    listLeaveTypes().then(setLeaveTypes).catch(() => setLeaveTypes([]))
    getBalances(user.id).then(setBalances).catch(() => setBalances([]))
    myApplications().then(setMyApps).catch(() => setMyApps([]))
    pendingApprovals().then(setPending).catch(() => setPending([]))
  }

  useEffect(() => {
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id])

  async function handleApply() {
    setError(null)
    setMessage(null)
    try {
      const app = await applyLeave({ leaveTypeId, startDate, endDate, reason })
      setMessage(`Applied for ${app.daysCount} day(s).`)
      setStartDate('')
      setEndDate('')
      setReason('')
      refresh()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to apply')
    }
  }

  async function handleDecision(id: string, approve: boolean) {
    await decideLeave(id, approve)
    refresh()
  }

  async function handleCancel(id: string) {
    await cancelLeave(id)
    refresh()
  }

  async function handleCreateType() {
    setError(null)
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
      refresh()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create leave type')
    }
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <h1 className="text-xl font-semibold">Leave</h1>

      {message && <p className="text-sm text-primary">{message}</p>}
      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="rounded-md border p-4">
        <h2 className="mb-2 font-medium">My Balances</h2>
        <div className="flex flex-wrap gap-4 text-sm">
          {balances.map((b) => (
            <div key={b.leaveType.id} className="rounded-md bg-muted px-3 py-2">
              <div className="font-medium">{leaveTypeLabel(b.leaveType)}</div>
              <div className="text-muted-foreground">{b.available} available</div>
            </div>
          ))}
          {balances.length === 0 && <p className="text-muted-foreground">No leave types configured yet.</p>}
        </div>
      </div>

      <div className="rounded-md border p-4">
        <h2 className="mb-2 font-medium">Apply for Leave</h2>
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex flex-col gap-1">
            <Label>Leave type</Label>
            <Select value={leaveTypeId} onValueChange={setLeaveTypeId}>
              <SelectTrigger className="w-48">
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
            <Label>Start date</Label>
            <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <Label>End date</Label>
            <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <Label>Reason</Label>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          <Button onClick={handleApply}>Apply</Button>
        </div>
      </div>

      <div className="rounded-md border p-4">
        <h2 className="mb-2 font-medium">My Applications</h2>
        <ul className="flex flex-col gap-2 text-sm">
          {myApps.map((a) => (
            <li key={a.id} className="flex items-center justify-between">
              <span>
                {a.startDate.slice(0, 10)} → {a.endDate.slice(0, 10)} ({a.daysCount}d){' '}
                <Badge variant="outline">{a.status}</Badge>
              </span>
              {a.status === 'APPROVED' && (
                <Button size="sm" variant="outline" onClick={() => handleCancel(a.id)}>
                  Cancel
                </Button>
              )}
            </li>
          ))}
          {myApps.length === 0 && <p className="text-muted-foreground">No applications yet.</p>}
        </ul>
      </div>

      {pending.length > 0 && (
        <div className="rounded-md border p-4">
          <h2 className="mb-2 font-medium">Pending Approvals</h2>
          <ul className="flex flex-col gap-2 text-sm">
            {pending.map((a) => (
              <li key={a.id} className="flex items-center justify-between">
                <span>
                  {a.employee?.firstName} {a.employee?.lastName}: {a.startDate.slice(0, 10)} →{' '}
                  {a.endDate.slice(0, 10)} ({a.daysCount}d)
                </span>
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => handleDecision(a.id, true)}>
                    Approve
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => handleDecision(a.id, false)}>
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
        </div>
      )}
    </div>
  )
}
