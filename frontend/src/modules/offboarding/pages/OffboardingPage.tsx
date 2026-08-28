import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { useAuth } from '@/shared/auth/AuthContext'
import { canAccessHrOperationalModules } from '@/shared/auth/role'
import { ApiError } from '@/lib/api'
import {
  submitResignation,
  listResignations,
  getResignation,
  adjustLwd,
  signoffClearance,
  submitExitInterview,
  computeSettlement,
  approveSettlement,
  markSettlementPaid,
  generateLetters,
  type Resignation,
  type FinalSettlement,
} from '../api'

export function OffboardingPage() {
  const { user } = useAuth()
  const isHrAdmin = canAccessHrOperationalModules(user?.role)

  const [noticePeriodDays, setNoticePeriodDays] = useState('30')
  const [lookupId, setLookupId] = useState('')
  const [active, setActive] = useState<Resignation | null>(null)

  const [allResignations, setAllResignations] = useState<Resignation[]>([])

  const [newLwd, setNewLwd] = useState('')
  const [lwdReason, setLwdReason] = useState('')

  const [exitResponses, setExitResponses] = useState('')

  const [perDayPayRate, setPerDayPayRate] = useState('')
  const [pendingSalary, setPendingSalary] = useState('')
  const [settlement, setSettlement] = useState<FinalSettlement | null>(null)
  const [closingRemarks, setClosingRemarks] = useState('')

  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  function loadActive(id: string) {
    getResignation(id)
      .then((r) => {
        setActive(r)
        setSettlement(null)
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load resignation'))
  }

  function refreshAllResignations() {
    listResignations().then(setAllResignations).catch(() => setAllResignations([]))
  }

  async function handleSubmitResignation() {
    setError(null)
    setMessage(null)
    try {
      const r = await submitResignation({ noticePeriodDays: Number(noticePeriodDays) })
      setActive(r)
      setMessage(`Resignation submitted — last working day ${r.lastWorkingDay.slice(0, 10)}.`)
      if (isHrAdmin) refreshAllResignations()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to submit resignation')
    }
  }

  function handleLookup() {
    if (!lookupId) return
    setError(null)
    loadActive(lookupId)
  }

  async function handleAdjustLwd() {
    if (!active || !newLwd) return
    setError(null)
    setMessage(null)
    try {
      await adjustLwd(active.id, { newDate: newLwd, reason: lwdReason })
      setMessage('Last working day updated — audit trail recorded.')
      setNewLwd('')
      setLwdReason('')
      loadActive(active.id)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to adjust last working day')
    }
  }

  async function handleExitInterview() {
    if (!active) return
    setError(null)
    setMessage(null)
    try {
      await submitExitInterview(active.id, { notes: exitResponses })
      setMessage('Exit interview submitted.')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to submit exit interview')
    }
  }

  async function handleSignoff(itemId: string) {
    setError(null)
    setMessage(null)
    try {
      await signoffClearance(itemId)
      setMessage('Clearance item signed off.')
      if (active) loadActive(active.id)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to sign off this clearance item')
    }
  }

  async function handleComputeSettlement() {
    if (!active || !perDayPayRate) return
    setError(null)
    setMessage(null)
    try {
      const s = await computeSettlement(active.id, Number(perDayPayRate), pendingSalary ? Number(pendingSalary) : undefined)
      setSettlement(s)
      setMessage('Settlement computed — leave encashment and asset recovery pulled automatically.')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to compute settlement')
    }
  }

  async function handleApproveSettlement() {
    if (!active) return
    setError(null)
    try {
      const s = await approveSettlement(active.id)
      setSettlement(s)
      setMessage('Settlement approved.')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to approve settlement')
    }
  }

  async function handleMarkPaid() {
    if (!active) return
    setError(null)
    try {
      await markSettlementPaid(active.id)
      setMessage('Settlement marked paid — employee archived.')
      loadActive(active.id)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to mark settlement paid')
    }
  }

  async function handleGenerateLetters() {
    if (!active) return
    setError(null)
    try {
      await generateLetters(active.id, closingRemarks || undefined)
      setMessage('Relieving and experience letters generated.')
      loadActive(active.id)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to generate letters')
    }
  }

  const leadVerificationItems = (active?.clearanceItems ?? []).filter((i) => i.category === 'LEAD_VERIFICATION')
  const employeeDeclarationItems = (active?.clearanceItems ?? []).filter((i) => i.category === 'EMPLOYEE_DECLARATION')

  return (
    <div className="flex flex-col gap-6 p-6">
      <h1 className="text-xl font-semibold">Offboarding</h1>

      {message && <p className="text-sm text-primary">{message}</p>}
      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="flex flex-col gap-4">
          <div className="rounded-md border p-4">
            <h2 className="mb-2 font-medium">Submit Resignation</h2>
            <div className="flex flex-wrap items-end gap-2">
              <div className="flex flex-col gap-1">
                <Label>Notice Period (days)</Label>
                <Input
                  type="number"
                  value={noticePeriodDays}
                  onChange={(e) => setNoticePeriodDays(e.target.value)}
                  className="w-32"
                />
              </div>
              <Button variant="outline" onClick={handleSubmitResignation}>
                Submit Resignation
              </Button>
            </div>

            <div className="mt-3 flex flex-wrap items-end gap-2 border-t pt-3">
              <Input placeholder="Resignation ID" value={lookupId} onChange={(e) => setLookupId(e.target.value)} />
              <Button size="sm" variant="outline" onClick={handleLookup}>
                Load
              </Button>
            </div>
          </div>

          {active && (
            <div className="rounded-md border p-4 text-sm">
              <div className="mb-2 flex items-center justify-between">
                <h2 className="font-medium">Resignation {active.id.slice(0, 8)}</h2>
                <Badge variant="outline">{active.status}</Badge>
              </div>
              <p>Submitted: {active.submittedDate.slice(0, 10)}</p>
              <p>Notice period: {active.noticePeriodDays} days</p>
              <p>Last working day: {active.lastWorkingDay.slice(0, 10)}</p>
              {active.relievingLetterRef && <p>Relieving letter: {active.relievingLetterRef}</p>}
              {active.experienceLetterRef && <p>Experience letter: {active.experienceLetterRef}</p>}

              <div className="mt-3 border-t pt-3">
                <p className="mb-1 font-medium">Separation Clearance Checklist — verified by Lead/POC</p>
                <ul className="flex flex-col gap-2">
                  {leadVerificationItems.map((item) => (
                    <li key={item.id} className="flex flex-wrap items-center gap-2 rounded border p-2">
                      <span className="flex-1">{item.label}</span>
                      <Badge variant={item.status === 'SIGNED_OFF' ? 'default' : 'outline'}>{item.status}</Badge>
                      {item.status === 'PENDING' && (
                        <Button size="sm" variant="outline" onClick={() => handleSignoff(item.id)}>
                          Verify
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>

                <p className="mb-1 mt-4 font-medium">Employee Self-Declaration</p>
                <ul className="flex flex-col gap-2">
                  {employeeDeclarationItems.map((item) => (
                    <li key={item.id} className="flex flex-wrap items-center gap-2 rounded border p-2">
                      <span className="flex-1">{item.label}</span>
                      <Badge variant={item.status === 'SIGNED_OFF' ? 'default' : 'outline'}>{item.status}</Badge>
                      {item.status === 'PENDING' && (
                        <Button size="sm" variant="outline" onClick={() => handleSignoff(item.id)}>
                          Confirm
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              </div>

              <div className="mt-3 flex flex-wrap items-end gap-2 border-t pt-3">
                <div className="flex flex-col gap-1">
                  <Label>Negotiate LWD</Label>
                  <Input type="date" value={newLwd} onChange={(e) => setNewLwd(e.target.value)} />
                </div>
                <Input placeholder="Reason" value={lwdReason} onChange={(e) => setLwdReason(e.target.value)} />
                <Button size="sm" variant="outline" onClick={handleAdjustLwd}>
                  Adjust LWD
                </Button>
              </div>

              <div className="mt-3 flex flex-col gap-2 border-t pt-3">
                <Label>Exit Interview</Label>
                <Textarea
                  placeholder="Feedback / responses"
                  value={exitResponses}
                  onChange={(e) => setExitResponses(e.target.value)}
                />
                <Button size="sm" variant="outline" onClick={handleExitInterview} className="self-start">
                  Submit Exit Interview
                </Button>
              </div>
            </div>
          )}
        </div>

        {isHrAdmin && (
          <div className="flex flex-col gap-4">
            <div className="rounded-md border p-4">
              <div className="mb-2 flex items-center justify-between">
                <h2 className="font-medium">All Resignations</h2>
                <Button size="sm" variant="outline" onClick={refreshAllResignations}>
                  Refresh
                </Button>
              </div>
              <ul className="flex flex-col gap-2 text-sm">
                {allResignations.map((r) => (
                  <li key={r.id} className="flex items-center justify-between rounded border p-2">
                    <button className="text-left hover:underline" onClick={() => loadActive(r.id)}>
                      {r.id.slice(0, 8)} — LWD {r.lastWorkingDay.slice(0, 10)}
                    </button>
                    <Badge variant="outline">{r.status}</Badge>
                  </li>
                ))}
                {allResignations.length === 0 && <p className="text-muted-foreground">No resignations yet.</p>}
              </ul>
            </div>

            {active && (
              <div className="rounded-md border p-4">
                <h2 className="mb-2 font-medium">Full &amp; Final Settlement</h2>
                <p className="mb-2 text-xs text-muted-foreground">
                  Leave encashment and asset recovery are pulled automatically from the Leave and Asset modules —
                  only the per-day pay rate is supplied here.
                </p>
                <div className="flex flex-wrap items-end gap-2">
                  <div className="flex flex-col gap-1">
                    <Label>Per-Day Pay Rate</Label>
                    <Input
                      type="number"
                      value={perDayPayRate}
                      onChange={(e) => setPerDayPayRate(e.target.value)}
                      className="w-32"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <Label>Pending Salary</Label>
                    <Input
                      type="number"
                      value={pendingSalary}
                      onChange={(e) => setPendingSalary(e.target.value)}
                      className="w-32"
                    />
                  </div>
                  <Button size="sm" variant="outline" onClick={handleComputeSettlement}>
                    Compute
                  </Button>
                </div>

                {settlement && (
                  <div className="mt-3 flex flex-col gap-1 border-t pt-3 text-sm">
                    <p>Leave encashment (auto): {settlement.leaveEncashment}</p>
                    <p>Asset recovery (auto): {settlement.assetRecovery}</p>
                    <p>Notice shortfall recovery: {settlement.noticeRecovery}</p>
                    <p>Pending salary: {settlement.pendingSalary}</p>
                    <p className="font-medium">Net payable: {settlement.netPayable}</p>
                    <Badge variant="outline" className="w-fit">
                      {settlement.status}
                    </Badge>
                    <div className="mt-2 flex gap-2">
                      {settlement.status === 'PENDING_APPROVAL' && (
                        <Button size="sm" variant="outline" onClick={handleApproveSettlement}>
                          Approve
                        </Button>
                      )}
                      {settlement.status === 'APPROVED' && (
                        <Button size="sm" variant="outline" onClick={handleMarkPaid}>
                          Mark Paid
                        </Button>
                      )}
                    </div>
                  </div>
                )}

                <div className="mt-3 flex flex-col gap-2 border-t pt-3">
                  <Label>Closing Remarks (HR only)</Label>
                  <Textarea
                    placeholder="Closing remarks"
                    value={closingRemarks}
                    onChange={(e) => setClosingRemarks(e.target.value)}
                  />
                  <Button size="sm" variant="outline" onClick={handleGenerateLetters} className="self-start">
                    Generate Relieving &amp; Experience Letters
                  </Button>
                  {active.certificateReleasedBy && (
                    <p className="text-xs text-muted-foreground">
                      Certificate released by {active.certificateReleasedBy}
                      {active.closingRemarks ? ` — ${active.closingRemarks}` : ''}
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
