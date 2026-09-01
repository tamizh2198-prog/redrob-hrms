"use client"

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
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

  // Each of these guards one in-flight mutation so a slow response can't be
  // double-fired by a second click — most of these steps (resign, adjust
  // LWD, compute/approve settlement, mark paid) are meant to happen exactly
  // once per resignation.
  const [submittingResignation, setSubmittingResignation] = useState(false)
  const [adjustingLwd, setAdjustingLwd] = useState(false)
  const [submittingExitInterview, setSubmittingExitInterview] = useState(false)
  const [signingOffId, setSigningOffId] = useState<string | null>(null)
  const [computingSettlement, setComputingSettlement] = useState(false)
  const [approvingSettlement, setApprovingSettlement] = useState(false)
  const [markingPaid, setMarkingPaid] = useState(false)
  const [generatingLetters, setGeneratingLetters] = useState(false)

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
    setSubmittingResignation(true)
    try {
      const r = await submitResignation({ noticePeriodDays: Number(noticePeriodDays) })
      setActive(r)
      setMessage(`Resignation submitted — last working day ${r.lastWorkingDay.slice(0, 10)}.`)
      if (isHrAdmin) refreshAllResignations()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to submit resignation')
    } finally {
      setSubmittingResignation(false)
    }
  }

  function handleLookup() {
    if (!lookupId) return
    setError(null)
    loadActive(lookupId)
  }

  async function handleAdjustLwd() {
    if (!active || !newLwd || adjustingLwd) return
    setError(null)
    setMessage(null)
    setAdjustingLwd(true)
    try {
      await adjustLwd(active.id, { newDate: newLwd, reason: lwdReason })
      setMessage('Last working day updated — audit trail recorded.')
      setNewLwd('')
      setLwdReason('')
      loadActive(active.id)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to adjust last working day')
    } finally {
      setAdjustingLwd(false)
    }
  }

  async function handleExitInterview() {
    if (!active || submittingExitInterview) return
    setError(null)
    setMessage(null)
    setSubmittingExitInterview(true)
    try {
      await submitExitInterview(active.id, { notes: exitResponses })
      setMessage('Exit interview submitted.')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to submit exit interview')
    } finally {
      setSubmittingExitInterview(false)
    }
  }

  async function handleSignoff(itemId: string) {
    if (signingOffId) return
    setError(null)
    setMessage(null)
    setSigningOffId(itemId)
    try {
      await signoffClearance(itemId)
      setMessage('Clearance item signed off.')
      if (active) loadActive(active.id)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to sign off this clearance item')
    } finally {
      setSigningOffId(null)
    }
  }

  async function handleComputeSettlement() {
    if (!active || !perDayPayRate || computingSettlement) return
    setError(null)
    setMessage(null)
    setComputingSettlement(true)
    try {
      const s = await computeSettlement(active.id, Number(perDayPayRate), pendingSalary ? Number(pendingSalary) : undefined)
      setSettlement(s)
      setMessage('Settlement computed — leave encashment and asset recovery pulled automatically.')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to compute settlement')
    } finally {
      setComputingSettlement(false)
    }
  }

  async function handleApproveSettlement() {
    if (!active || approvingSettlement) return
    setError(null)
    setApprovingSettlement(true)
    try {
      const s = await approveSettlement(active.id)
      setSettlement(s)
      setMessage('Settlement approved.')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to approve settlement')
    } finally {
      setApprovingSettlement(false)
    }
  }

  async function handleMarkPaid() {
    if (!active || markingPaid) return
    setError(null)
    setMarkingPaid(true)
    try {
      await markSettlementPaid(active.id)
      setMessage('Settlement marked paid — employee archived.')
      loadActive(active.id)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to mark settlement paid')
    } finally {
      setMarkingPaid(false)
    }
  }

  async function handleGenerateLetters() {
    if (!active || generatingLetters) return
    setError(null)
    setGeneratingLetters(true)
    try {
      await generateLetters(active.id, closingRemarks || undefined)
      setMessage('Relieving and experience letters generated.')
      loadActive(active.id)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to generate letters')
    } finally {
      setGeneratingLetters(false)
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
          <Card>
            <CardHeader>
              <CardTitle>Submit Resignation</CardTitle>
            </CardHeader>
            <CardContent>
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
              <Button variant="outline" disabled={submittingResignation} onClick={handleSubmitResignation}>
                {submittingResignation ? 'Submitting…' : 'Submit Resignation'}
              </Button>
            </div>

            <div className="mt-3 flex flex-wrap items-end gap-2 border-t pt-3">
              <Input placeholder="Resignation ID" value={lookupId} onChange={(e) => setLookupId(e.target.value)} />
              <Button size="sm" variant="outline" onClick={handleLookup}>
                Load
              </Button>
            </div>
            </CardContent>
          </Card>

          {active && (
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>Resignation {active.id.slice(0, 8)}</CardTitle>
                  <Badge variant="outline">{active.status}</Badge>
                </div>
              </CardHeader>
              <CardContent className="text-sm">
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
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={signingOffId !== null}
                          onClick={() => handleSignoff(item.id)}
                        >
                          {signingOffId === item.id ? 'Verifying…' : 'Verify'}
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
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={signingOffId !== null}
                          onClick={() => handleSignoff(item.id)}
                        >
                          {signingOffId === item.id ? 'Confirming…' : 'Confirm'}
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
                <Button size="sm" variant="outline" disabled={adjustingLwd} onClick={handleAdjustLwd}>
                  {adjustingLwd ? 'Adjusting…' : 'Adjust LWD'}
                </Button>
              </div>

              <div className="mt-3 flex flex-col gap-2 border-t pt-3">
                <Label>Exit Interview</Label>
                <Textarea
                  placeholder="Feedback / responses"
                  value={exitResponses}
                  onChange={(e) => setExitResponses(e.target.value)}
                />
                <Button
                  size="sm"
                  variant="outline"
                  disabled={submittingExitInterview}
                  onClick={handleExitInterview}
                  className="self-start"
                >
                  {submittingExitInterview ? 'Submitting…' : 'Submit Exit Interview'}
                </Button>
              </div>
              </CardContent>
            </Card>
          )}
        </div>

        {isHrAdmin && (
          <div className="flex flex-col gap-4">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>All Resignations</CardTitle>
                  <Button size="sm" variant="outline" onClick={refreshAllResignations}>
                    Refresh
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
              <ul className="flex flex-col gap-2 text-sm">
                {allResignations.map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-2 rounded-md border p-2">
                    <button
                      className="flex flex-1 flex-wrap items-center justify-between gap-2 text-left hover:underline"
                      onClick={() => loadActive(r.id)}
                    >
                      <span className="font-medium">
                        {r.employee ? `${r.employee.firstName} ${r.employee.lastName} (${r.employee.employeeCode})` : r.id.slice(0, 8)}
                      </span>
                      <span className="text-muted-foreground">LWD {r.lastWorkingDay.slice(0, 10)}</span>
                    </button>
                    <Badge variant="outline">{r.status}</Badge>
                  </li>
                ))}
                {allResignations.length === 0 && <p className="text-muted-foreground">No resignations yet.</p>}
              </ul>
              </CardContent>
            </Card>

            {active && (
              <Card>
                <CardHeader>
                  <CardTitle>Full &amp; Final Settlement</CardTitle>
                </CardHeader>
                <CardContent>
                <p className="mb-2 text-xs text-muted-foreground">
                  Asset recovery is pulled automatically from the Asset module (leave encashment stays 0 — the
                  Leave module was removed); only the per-day pay rate is supplied here.
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
                  <Button size="sm" variant="outline" disabled={computingSettlement} onClick={handleComputeSettlement}>
                    {computingSettlement ? 'Computing…' : 'Compute'}
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
                        <Button size="sm" variant="success" disabled={approvingSettlement} onClick={handleApproveSettlement}>
                          {approvingSettlement ? 'Approving…' : 'Approve'}
                        </Button>
                      )}
                      {settlement.status === 'APPROVED' && (
                        <Button size="sm" variant="outline" disabled={markingPaid} onClick={handleMarkPaid}>
                          {markingPaid ? 'Marking…' : 'Mark Paid'}
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
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={generatingLetters}
                    onClick={handleGenerateLetters}
                    className="self-start"
                  >
                    {generatingLetters ? 'Generating…' : 'Generate Relieving & Experience Letters'}
                  </Button>
                  {active.certificateReleasedBy && (
                    <p className="text-xs text-muted-foreground">
                      Certificate released by {active.certificateReleasedBy}
                      {active.closingRemarks ? ` — ${active.closingRemarks}` : ''}
                    </p>
                  )}
                </div>
                </CardContent>
              </Card>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
