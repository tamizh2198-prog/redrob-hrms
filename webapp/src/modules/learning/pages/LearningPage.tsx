"use client"

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
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

function personName(p?: { firstName: string; lastName: string } | null) {
  return p ? `${p.firstName} ${p.lastName}` : null
}

// Manager is the assigned stage-1 approver (visible as soon as it's
// raised); the actual decision-maker is whoever most recently acted —
// finalApprover (Super Admin sign-off) if the request got that far,
// otherwise managerApprover (e.g. rejected at the manager stage).
function approverSummary(r: LearningRequest): string | null {
  const manager = personName(r.approver)
  const decidedBy = personName(r.finalApprover) ?? personName(r.managerApprover)
  const parts: string[] = []
  if (manager) parts.push(`Manager: ${manager}`)
  if (decidedBy) parts.push(`Decided by: ${decidedBy}`)
  return parts.length > 0 ? parts.join(' · ') : null
}

export function LearningPage() {
  const { user } = useAuth()
  const isSuperAdmin = user?.role === 'SUPER_ADMIN'

  const [mySpendLimit, setMySpendLimit] = useState<SpendLimit | null>(null)
  const [allSpendLimits, setAllSpendLimits] = useState<SpendLimitWithEmployee[]>([])
  const [spendLimitSearch, setSpendLimitSearch] = useState('')
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
  const [submitting, setSubmitting] = useState(false)
  // Keyed by request id — each of these guards a single in-flight mutation
  // on that one request, so a slow response can't be double-fired by a
  // second click and other requests' buttons stay usable in the meantime.
  const [deciding, setDeciding] = useState<{ id: string; approve: boolean } | null>(null)
  const [submittingCertId, setSubmittingCertId] = useState<string | null>(null)
  const [markingReimbursedId, setMarkingReimbursedId] = useState<string | null>(null)

  const spendLimitQuery = spendLimitSearch.trim().toLowerCase()
  const filteredSpendLimits = spendLimitQuery
    ? allSpendLimits.filter((s) =>
        `${s.firstName} ${s.lastName} ${s.employeeCode}`.toLowerCase().includes(spendLimitQuery),
      )
    : allSpendLimits

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
    setSubmitting(true)
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
    } finally {
      setSubmitting(false)
    }
  }

  async function handleDecision(id: string, approve: boolean) {
    if (deciding) return
    setError(null)
    setDeciding({ id, approve })
    try {
      await decideLearningRequest(id, approve)
      refresh()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to record decision')
    } finally {
      setDeciding(null)
    }
  }

  async function handleSubmitCertificate(id: string) {
    const ref = certificateRefById[id]
    if (!ref || submittingCertId) return
    setError(null)
    setSubmittingCertId(id)
    try {
      await submitLearningCertificate(id, ref)
      setCertificateRefById((prev) => ({ ...prev, [id]: '' }))
      setMessage('Certificate submitted — reimbursement is now pending.')
      refresh()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to submit certificate')
    } finally {
      setSubmittingCertId(null)
    }
  }

  async function handleMarkReimbursed(id: string) {
    if (markingReimbursedId) return
    setError(null)
    setMarkingReimbursedId(id)
    try {
      await markLearningReimbursed(id)
      refresh()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to mark reimbursed')
    } finally {
      setMarkingReimbursedId(null)
    }
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <h1 className="text-xl font-semibold">Learning</h1>

      {message && <p className="text-sm text-primary">{message}</p>}
      {error && <p className="text-sm text-destructive">{error}</p>}

      <Card>
        <CardHeader>
          <CardTitle>My Spend Limit ({mySpendLimit?.requestYear ?? new Date().getFullYear()})</CardTitle>
        </CardHeader>
        <CardContent>
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
              Your CTC isn&apos;t on file yet — contact HR before requesting learning reimbursement.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Request Learning</CardTitle>
        </CardHeader>
        <CardContent>
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
            disabled={submitting || !courseName || !duration || !purpose || !organizationalImpact || !cost || !timeCommitment}
          >
            {submitting ? 'Submitting…' : 'Submit Request'}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>My Learning Requests</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="flex flex-col gap-2 text-sm">
            {myRequests.map((r) => (
              <li key={r.id} className="rounded-md border p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">
                    {r.courseName} — {formatCurrency(r.cost)}
                  </span>
                  <Badge variant={statusBadgeVariant(r.status)}>{STATUS_LABELS[r.status]}</Badge>
                </div>
                {approverSummary(r) && (
                  <p className="mt-1 text-xs text-muted-foreground">{approverSummary(r)}</p>
                )}
                {r.status === 'APPROVED' && (
                  <div className="mt-2 flex gap-2">
                    <Input
                      placeholder="Certificate link / reference"
                      value={certificateRefById[r.id] ?? ''}
                      disabled={submittingCertId === r.id}
                      onChange={(e) =>
                        setCertificateRefById((prev) => ({ ...prev, [r.id]: e.target.value }))
                      }
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={submittingCertId !== null}
                      onClick={() => handleSubmitCertificate(r.id)}
                    >
                      {submittingCertId === r.id ? 'Submitting…' : 'Submit Certificate'}
                    </Button>
                  </div>
                )}
              </li>
            ))}
            {myRequests.length === 0 && <p className="text-muted-foreground">No requests yet.</p>}
          </ul>
        </CardContent>
      </Card>

      {pendingForMe.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Pending Requests to Decide (Manager)</CardTitle>
          </CardHeader>
          <CardContent>
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
                      <Button
                        size="sm"
                        variant="success"
                        disabled={deciding !== null}
                        onClick={() => handleDecision(r.id, true)}
                      >
                        {deciding?.id === r.id && deciding.approve ? 'Approving…' : 'Approve'}
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        disabled={deciding !== null}
                        onClick={() => handleDecision(r.id, false)}
                      >
                        {deciding?.id === r.id && !deciding.approve ? 'Rejecting…' : 'Reject'}
                      </Button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {isSuperAdmin && managerStageVisibility.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Awaiting Manager Approval (not yet actionable)</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-2 text-sm">
              {managerStageVisibility.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-2 rounded-md bg-muted px-2 py-1">
                  <span className="flex flex-1 flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">
                      {r.employee ? `${r.employee.firstName} ${r.employee.lastName}` : r.employeeId}
                    </span>
                    <span className="text-muted-foreground">
                      {r.courseName} ({formatCurrency(r.cost)})
                    </span>
                    {approverSummary(r) && (
                      <span className="text-xs text-muted-foreground">{approverSummary(r)}</span>
                    )}
                  </span>
                  <Badge variant="outline">Manager review pending</Badge>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {isSuperAdmin && pendingFinalApproval.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Pending Final Approval (Super Admin)</CardTitle>
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
                      <div className="text-muted-foreground">
                        {r.courseName} — {formatCurrency(r.cost)} — {r.duration}
                      </div>
                      <div className="text-muted-foreground">
                        {approverSummary(r) ?? 'Manager already approved this request.'}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="success"
                        disabled={deciding !== null}
                        onClick={() => handleDecision(r.id, true)}
                      >
                        {deciding?.id === r.id && deciding.approve ? 'Approving…' : 'Approve'}
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        disabled={deciding !== null}
                        onClick={() => handleDecision(r.id, false)}
                      >
                        {deciding?.id === r.id && !deciding.approve ? 'Rejecting…' : 'Reject'}
                      </Button>
                    </div>
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
            <CardTitle>All Employees&apos; Spend Limits ({new Date().getFullYear()})</CardTitle>
          </CardHeader>
          <CardContent>
            <Input
              placeholder="Search by name or employee code"
              value={spendLimitSearch}
              onChange={(e) => setSpendLimitSearch(e.target.value)}
              className="mb-2 max-w-xs"
            />
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
                  {filteredSpendLimits.map((s) => (
                    <TableRow key={s.employeeId}>
                      <TableCell>
                        {s.firstName} {s.lastName} ({s.employeeCode})
                      </TableCell>
                      <TableCell>{s.ctcLpa ?? <span className="text-muted-foreground">Not on file</span>}</TableCell>
                      <TableCell>
                        {s.annualLimit != null ? (
                          formatCurrency(s.annualLimit)
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>{formatCurrency(s.used)}</TableCell>
                      <TableCell>
                        {s.remaining != null ? (
                          formatCurrency(s.remaining)
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                  {filteredSpendLimits.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center text-muted-foreground">
                        {allSpendLimits.length === 0 ? 'No employees found.' : 'No employees match your search.'}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {isSuperAdmin && (
        <Card>
          <CardHeader>
            <CardTitle>All Learning Requests</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-2 text-sm">
              {allRequests.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-2 rounded-md border p-3">
                  <div>
                    <div className="font-medium">
                      {r.employee ? `${r.employee.firstName} ${r.employee.lastName}` : r.employeeId}
                    </div>
                    <div className="text-muted-foreground">
                      {r.courseName} ({formatCurrency(r.cost)})
                    </div>
                    {approverSummary(r) && (
                      <p className="text-xs text-muted-foreground">{approverSummary(r)}</p>
                    )}
                    <Badge variant={statusBadgeVariant(r.status)}>{STATUS_LABELS[r.status]}</Badge>
                  </div>
                  {r.status === 'COMPLETED' && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={markingReimbursedId !== null}
                      onClick={() => handleMarkReimbursed(r.id)}
                    >
                      {markingReimbursedId === r.id ? 'Marking…' : 'Mark Reimbursed'}
                    </Button>
                  )}
                </li>
              ))}
              {allRequests.length === 0 && <p className="text-muted-foreground">No requests yet.</p>}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
