import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useAuth } from '@/shared/auth/AuthContext'
import { ApiError } from '@/lib/api'
import {
  getMySpendLimit,
  listAllSpendLimits,
  submitLearningRequest,
  myLearningRequests,
  pendingLearningRequestsForMe,
  pendingLearningManagerStageForVisibility,
  pendingLearningFinalApproval,
  decideLearningRequest,
  submitLearningCertificate,
  markLearningReimbursed,
  listAllLearningRequests,
  type SpendLimit,
  type SpendLimitWithEmployee,
  type LearningRequest,
} from '../api'

const STATUS_LABELS: Record<LearningRequest['status'], string> = {
  PENDING_MANAGER: 'Pending Manager',
  PENDING_SUPER_ADMIN: 'Pending Super Admin',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  COMPLETED: 'Completed — Awaiting Reimbursement',
  REIMBURSED: 'Reimbursed',
}

function statusBadgeVariant(status: LearningRequest['status']) {
  if (status === 'APPROVED' || status === 'REIMBURSED') return 'default' as const
  if (status === 'REJECTED') return 'destructive' as const
  return 'outline' as const
}

function formatCurrency(amount: number) {
  return `₹${amount.toLocaleString('en-IN')}`
}

export function LearningPage() {
  const { user } = useAuth()
  const isSuperAdmin = user?.role === 'SUPER_ADMIN'

  const [mySpendLimit, setMySpendLimit] = useState<SpendLimit | null>(null)
  const [allSpendLimits, setAllSpendLimits] = useState<SpendLimitWithEmployee[]>([])
  const [myRequests, setMyRequests] = useState<LearningRequest[]>([])
  const [pendingForMe, setPendingForMe] = useState<LearningRequest[]>([])
  const [managerStageVisibility, setManagerStageVisibility] = useState<LearningRequest[]>([])
  const [pendingFinalApproval, setPendingFinalApproval] = useState<LearningRequest[]>([])
  const [allRequests, setAllRequests] = useState<LearningRequest[]>([])

  const [courseName, setCourseName] = useState('')
  const [duration, setDuration] = useState('')
  const [purpose, setPurpose] = useState('')
  const [organizationalImpact, setOrganizationalImpact] = useState('')
  const [cost, setCost] = useState('')
  const [timeCommitment, setTimeCommitment] = useState('')

  const [certificateRefById, setCertificateRefById] = useState<Record<string, string>>({})

  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  function refresh() {
    getMySpendLimit().then(setMySpendLimit).catch(() => setMySpendLimit(null))
    myLearningRequests().then(setMyRequests).catch(() => setMyRequests([]))
    pendingLearningRequestsForMe().then(setPendingForMe).catch(() => setPendingForMe([]))
    if (isSuperAdmin) {
      listAllSpendLimits().then(setAllSpendLimits).catch(() => setAllSpendLimits([]))
      pendingLearningManagerStageForVisibility()
        .then(setManagerStageVisibility)
        .catch(() => setManagerStageVisibility([]))
      pendingLearningFinalApproval().then(setPendingFinalApproval).catch(() => setPendingFinalApproval([]))
      listAllLearningRequests().then(setAllRequests).catch(() => setAllRequests([]))
    }
  }

  useEffect(() => {
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handleSubmitRequest() {
    setError(null)
    setMessage(null)
    try {
      await submitLearningRequest({
        courseName,
        duration,
        purpose,
        organizationalImpact,
        cost: Number(cost) || 0,
        timeCommitment,
      })
      setMessage('Learning request submitted.')
      setCourseName('')
      setDuration('')
      setPurpose('')
      setOrganizationalImpact('')
      setCost('')
      setTimeCommitment('')
      refresh()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to submit request')
    }
  }

  async function handleDecision(id: string, approve: boolean) {
    setError(null)
    try {
      await decideLearningRequest(id, approve)
      refresh()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to record decision')
    }
  }

  async function handleSubmitCertificate(id: string) {
    const ref = certificateRefById[id]
    if (!ref) return
    setError(null)
    try {
      await submitLearningCertificate(id, ref)
      setCertificateRefById((prev) => ({ ...prev, [id]: '' }))
      setMessage('Certificate submitted — reimbursement is now pending.')
      refresh()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to submit certificate')
    }
  }

  async function handleMarkReimbursed(id: string) {
    setError(null)
    try {
      await markLearningReimbursed(id)
      refresh()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to mark reimbursed')
    }
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <h1 className="text-xl font-semibold">Learning</h1>

      {message && <p className="text-sm text-primary">{message}</p>}
      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="rounded-md border p-4">
        <h2 className="mb-2 font-medium">My Spend Limit ({mySpendLimit?.requestYear ?? new Date().getFullYear()})</h2>
        {mySpendLimit ? (
          <div className="flex flex-wrap gap-6 text-sm">
            <div className="rounded-md bg-muted px-3 py-2">
              <div className="text-xs text-muted-foreground">Annual Limit</div>
              <div className="text-lg font-semibold">{formatCurrency(mySpendLimit.annualLimit)}</div>
            </div>
            <div className="rounded-md bg-muted px-3 py-2">
              <div className="text-xs text-muted-foreground">Used</div>
              <div className="text-lg font-semibold">{formatCurrency(mySpendLimit.used)}</div>
            </div>
            <div className="rounded-md bg-muted px-3 py-2">
              <div className="text-xs text-muted-foreground">Remaining</div>
              <div className="text-lg font-semibold">{formatCurrency(mySpendLimit.remaining)}</div>
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Your CTC isn't on file yet — contact HR before requesting learning reimbursement.
          </p>
        )}
      </div>

      <div className="rounded-md border p-4">
        <h2 className="mb-2 font-medium">Request Learning</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <Label>Course name</Label>
            <Input value={courseName} onChange={(e) => setCourseName(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <Label>Duration</Label>
            <Input
              placeholder="e.g. 6 weeks"
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1 sm:col-span-2">
            <Label>Use of the course</Label>
            <Textarea value={purpose} onChange={(e) => setPurpose(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1 sm:col-span-2">
            <Label>What impact will this create for the organization?</Label>
            <Textarea
              value={organizationalImpact}
              onChange={(e) => setOrganizationalImpact(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label>Cost</Label>
            <Input type="number" min={0} value={cost} onChange={(e) => setCost(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <Label>Time commitment</Label>
            <Input
              placeholder="e.g. 5 hours/week"
              value={timeCommitment}
              onChange={(e) => setTimeCommitment(e.target.value)}
            />
          </div>
        </div>
        <Button
          className="mt-3"
          variant="outline"
          onClick={handleSubmitRequest}
          disabled={!courseName || !duration || !purpose || !organizationalImpact || !cost || !timeCommitment}
        >
          Submit Request
        </Button>
      </div>

      <div className="rounded-md border p-4">
        <h2 className="mb-2 font-medium">My Learning Requests</h2>
        <ul className="flex flex-col gap-2 text-sm">
          {myRequests.map((r) => (
            <li key={r.id} className="rounded border p-3">
              <div className="flex items-center justify-between">
                <span className="font-medium">
                  {r.courseName} — {formatCurrency(r.cost)}
                </span>
                <Badge variant={statusBadgeVariant(r.status)}>{STATUS_LABELS[r.status]}</Badge>
              </div>
              {r.status === 'APPROVED' && (
                <div className="mt-2 flex gap-2">
                  <Input
                    placeholder="Certificate link / reference"
                    value={certificateRefById[r.id] ?? ''}
                    onChange={(e) =>
                      setCertificateRefById((prev) => ({ ...prev, [r.id]: e.target.value }))
                    }
                  />
                  <Button size="sm" variant="outline" onClick={() => handleSubmitCertificate(r.id)}>
                    Submit Certificate
                  </Button>
                </div>
              )}
            </li>
          ))}
          {myRequests.length === 0 && <p className="text-muted-foreground">No requests yet.</p>}
        </ul>
      </div>

      {pendingForMe.length > 0 && (
        <div className="rounded-md border p-4">
          <h2 className="mb-2 font-medium">Pending Requests to Decide (Manager)</h2>
          <ul className="flex flex-col gap-3 text-sm">
            {pendingForMe.map((r) => (
              <li key={r.id} className="rounded-md border p-3">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium">
                      {r.employee ? `${r.employee.firstName} ${r.employee.lastName}` : r.employeeId}
                    </div>
                    <div className="text-muted-foreground">
                      {r.courseName} — {formatCurrency(r.cost)} — {r.duration}
                    </div>
                    <div className="text-muted-foreground">Purpose: {r.purpose}</div>
                    <div className="text-muted-foreground">Impact: {r.organizationalImpact}</div>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => handleDecision(r.id, true)}>
                      Approve
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => handleDecision(r.id, false)}>
                      Reject
                    </Button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {isSuperAdmin && managerStageVisibility.length > 0 && (
        <div className="rounded-md border p-4">
          <h2 className="mb-2 font-medium">Awaiting Manager Approval (not yet actionable)</h2>
          <ul className="flex flex-col gap-2 text-sm">
            {managerStageVisibility.map((r) => (
              <li key={r.id} className="flex items-center justify-between rounded-md bg-muted px-2 py-1">
                <span>
                  {r.employee ? `${r.employee.firstName} ${r.employee.lastName}` : r.employeeId} —{' '}
                  {r.courseName} ({formatCurrency(r.cost)})
                </span>
                <Badge variant="outline">Manager review pending</Badge>
              </li>
            ))}
          </ul>
        </div>
      )}

      {isSuperAdmin && pendingFinalApproval.length > 0 && (
        <div className="rounded-md border p-4">
          <h2 className="mb-2 font-medium">Pending Final Approval (Super Admin)</h2>
          <ul className="flex flex-col gap-3 text-sm">
            {pendingFinalApproval.map((r) => (
              <li key={r.id} className="rounded-md border p-3">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium">
                      {r.employee ? `${r.employee.firstName} ${r.employee.lastName}` : r.employeeId}
                    </div>
                    <div className="text-muted-foreground">
                      {r.courseName} — {formatCurrency(r.cost)} — {r.duration}
                    </div>
                    <div className="text-muted-foreground">Manager already approved this request.</div>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => handleDecision(r.id, true)}>
                      Approve
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => handleDecision(r.id, false)}>
                      Reject
                    </Button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {isSuperAdmin && (
        <div className="rounded-md border p-4">
          <h2 className="mb-2 font-medium">All Employees' Spend Limits ({new Date().getFullYear()})</h2>
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee</TableHead>
                  <TableHead>CTC (LPA)</TableHead>
                  <TableHead>Annual Limit</TableHead>
                  <TableHead>Used</TableHead>
                  <TableHead>Remaining</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {allSpendLimits.map((s) => (
                  <TableRow key={s.employeeId}>
                    <TableCell>
                      {s.firstName} {s.lastName} ({s.employeeCode})
                    </TableCell>
                    <TableCell>{s.ctcLpa}</TableCell>
                    <TableCell>{formatCurrency(s.annualLimit)}</TableCell>
                    <TableCell>{formatCurrency(s.used)}</TableCell>
                    <TableCell>{formatCurrency(s.remaining)}</TableCell>
                  </TableRow>
                ))}
                {allSpendLimits.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-muted-foreground">
                      No employees with CTC on file yet.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      {isSuperAdmin && (
        <div className="rounded-md border p-4">
          <h2 className="mb-2 font-medium">All Learning Requests</h2>
          <ul className="flex flex-col gap-2 text-sm">
            {allRequests.map((r) => (
              <li key={r.id} className="flex items-center justify-between rounded border p-3">
                <div>
                  <div className="font-medium">
                    {r.employee ? `${r.employee.firstName} ${r.employee.lastName}` : r.employeeId} —{' '}
                    {r.courseName} ({formatCurrency(r.cost)})
                  </div>
                  <Badge variant={statusBadgeVariant(r.status)}>{STATUS_LABELS[r.status]}</Badge>
                </div>
                {r.status === 'COMPLETED' && (
                  <Button size="sm" variant="outline" onClick={() => handleMarkReimbursed(r.id)}>
                    Mark Reimbursed
                  </Button>
                )}
              </li>
            ))}
            {allRequests.length === 0 && <p className="text-muted-foreground">No requests yet.</p>}
          </ul>
        </div>
      )}
    </div>
  )
}
