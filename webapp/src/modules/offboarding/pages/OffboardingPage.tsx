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
  acceptResignation,
  rejectResignation,
  listResignations,
  getResignation,
  adjustLwd,
  signoffClearance,
  submitExitInterview,
  computeSettlement,
  approveSettlement,
  markSettlementPaid,
  previewRelievingLetter,
  sendRelievingLetter,
  updateRelievingLetter,
  type Resignation,
  type FinalSettlement,
  type RelievingLetterData,
} from '../api'

type EditableLetterFields = Omit<RelievingLetterData, 'employeeCode' | 'gender'>

const LETTER_FIELD_LABELS: Record<keyof EditableLetterFields, string> = {
  employeeName: 'Employee name',
  dateOfJoining: 'Date of joining',
  lastWorkingDay: 'Last working day',
  designation: 'Designation',
  location: 'Location',
  department: 'Department',
  generatedDate: 'Letter date',
}

export function OffboardingPage() {
  const { user } = useAuth()
  const isHrAdmin = canAccessHrOperationalModules(user?.role)

  const [noticePeriodDays, setNoticePeriodDays] = useState('45')
  const [personalEmail, setPersonalEmail] = useState('')
  const [lookupId, setLookupId] = useState('')
  const [active, setActive] = useState<Resignation | null>(null)
  const [rejectReason, setRejectReason] = useState('')

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
  const [accepting, setAccepting] = useState(false)
  const [rejecting, setRejecting] = useState(false)
  const [adjustingLwd, setAdjustingLwd] = useState(false)
  const [submittingExitInterview, setSubmittingExitInterview] = useState(false)
  const [signingOffId, setSigningOffId] = useState<string | null>(null)
  const [computingSettlement, setComputingSettlement] = useState(false)
  const [approvingSettlement, setApprovingSettlement] = useState(false)
  const [markingPaid, setMarkingPaid] = useState(false)
  const [previewingLetter, setPreviewingLetter] = useState(false)
  const [sendingLetter, setSendingLetter] = useState(false)
  const [editingLetter, setEditingLetter] = useState(false)
  const [letterForm, setLetterForm] = useState<EditableLetterFields | null>(null)
  const [savingLetter, setSavingLetter] = useState(false)

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
    if (!personalEmail) return
    setError(null)
    setMessage(null)
    setSubmittingResignation(true)
    try {
      const r = await submitResignation({ noticePeriodDays: Number(noticePeriodDays), personalEmail })
      setActive(r)
      setMessage(`Resignation submitted, pending acceptance — last working day ${r.lastWorkingDay.slice(0, 10)}.`)
      if (isHrAdmin) refreshAllResignations()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to submit resignation')
    } finally {
      setSubmittingResignation(false)
    }
  }

  async function handleAccept() {
    if (!active || accepting) return
    setError(null)
    setMessage(null)
    setAccepting(true)
    try {
      await acceptResignation(active.id)
      setMessage('Resignation accepted — the separation clearance checklist is now active.')
      loadActive(active.id)
      if (isHrAdmin) refreshAllResignations()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to accept resignation')
    } finally {
      setAccepting(false)
    }
  }

  async function handleReject() {
    if (!active || rejecting) return
    setError(null)
    setMessage(null)
    setRejecting(true)
    try {
      await rejectResignation(active.id, rejectReason)
      setMessage('Resignation rejected.')
      setRejectReason('')
      loadActive(active.id)
      if (isHrAdmin) refreshAllResignations()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to reject resignation')
    } finally {
      setRejecting(false)
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

  async function handlePreviewLetter() {
    if (!active || previewingLetter) return
    setError(null)
    setPreviewingLetter(true)
    try {
      await previewRelievingLetter(active.id)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load the letter preview')
    } finally {
      setPreviewingLetter(false)
    }
  }

  async function handleSendLetter() {
    if (!active || sendingLetter) return
    setError(null)
    setMessage(null)
    setSendingLetter(true)
    try {
      await sendRelievingLetter(active.id, closingRemarks || undefined)
      setMessage('Relieving and experience letter emailed to the employee’s personal email.')
      loadActive(active.id)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to send the letter')
    } finally {
      setSendingLetter(false)
    }
  }

  function startEditingLetter() {
    if (!active?.letterDataSnapshot) return
    const { employeeName, dateOfJoining, lastWorkingDay, designation, location, department, generatedDate } =
      active.letterDataSnapshot
    setLetterForm({ employeeName, dateOfJoining, lastWorkingDay, designation, location, department, generatedDate })
    setEditingLetter(true)
  }

  async function handleSaveLetter() {
    if (!active || !letterForm || savingLetter) return
    setError(null)
    setMessage(null)
    setSavingLetter(true)
    try {
      await updateRelievingLetter(active.id, letterForm)
      setMessage('Letter updated. Preview it again to confirm before sending.')
      setEditingLetter(false)
      loadActive(active.id)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to update the letter')
    } finally {
      setSavingLetter(false)
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
              <div className="flex flex-col gap-1">
                <Label>Personal Email (required — the relieving/experience letter goes here)</Label>
                <Input
                  type="email"
                  value={personalEmail}
                  onChange={(e) => setPersonalEmail(e.target.value)}
                  className="w-64"
                />
              </div>
              <Button variant="outline" disabled={submittingResignation || !personalEmail} onClick={handleSubmitResignation}>
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

              {isHrAdmin && active.status === 'SUBMITTED' && (
                <div className="mt-3 flex flex-col gap-2 border-t pt-3">
                  <p className="font-medium">This resignation is awaiting a decision.</p>
                  <div className="flex flex-wrap items-end gap-2">
                    <Button size="sm" variant="success" disabled={accepting || rejecting} onClick={handleAccept}>
                      {accepting ? 'Accepting…' : 'Accept'}
                    </Button>
                    <Input
                      placeholder="Reason for rejecting (optional)"
                      value={rejectReason}
                      onChange={(e) => setRejectReason(e.target.value)}
                      className="w-64"
                    />
                    <Button size="sm" variant="destructive" disabled={accepting || rejecting} onClick={handleReject}>
                      {rejecting ? 'Rejecting…' : 'Reject'}
                    </Button>
                  </div>
                </div>
              )}

              {active.status !== 'SUBMITTED' && active.status !== 'REJECTED' && (
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
              )}

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

                {active.status === 'CLEARED' && (
                  <div className="mt-3 flex flex-col gap-2 border-t pt-3">
                    <div className="flex items-center justify-between">
                      <Label>Relieving &amp; Experience Letter</Label>
                      <Badge variant={active.letterStatus === 'SENT' ? 'default' : 'outline'}>
                        {active.letterStatus.replaceAll('_', ' ')}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Auto-generated once the separation checklist was fully signed off, using the employee&apos;s
                      data. Verify it looks right before sending — it goes to their personal email, not their work
                      account.
                    </p>
                    {editingLetter && letterForm ? (
                      <div className="flex flex-col gap-2 rounded-md border p-3">
                        {(Object.keys(LETTER_FIELD_LABELS) as (keyof EditableLetterFields)[]).map((field) => (
                          <div key={field} className="flex flex-col gap-1">
                            <Label className="text-xs">{LETTER_FIELD_LABELS[field]}</Label>
                            <Input
                              value={letterForm[field]}
                              onChange={(e) => setLetterForm((f) => (f ? { ...f, [field]: e.target.value } : f))}
                            />
                          </div>
                        ))}
                        <div className="flex gap-2 pt-1">
                          <Button size="sm" disabled={savingLetter} onClick={handleSaveLetter}>
                            {savingLetter ? 'Saving…' : 'Save Changes'}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={savingLetter}
                            onClick={() => setEditingLetter(false)}
                          >
                            Cancel
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <Textarea
                        placeholder="Closing remarks (optional)"
                        value={closingRemarks}
                        onChange={(e) => setClosingRemarks(e.target.value)}
                      />
                    )}
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" disabled={previewingLetter} onClick={handlePreviewLetter}>
                        {previewingLetter ? 'Loading…' : 'Preview Letter'}
                      </Button>
                      {active.letterStatus === 'PENDING_VERIFICATION' && !editingLetter && (
                        <Button size="sm" variant="outline" onClick={startEditingLetter}>
                          Edit Letter
                        </Button>
                      )}
                      {active.letterStatus === 'PENDING_VERIFICATION' && (
                        <Button size="sm" variant="success" disabled={sendingLetter || editingLetter} onClick={handleSendLetter}>
                          {sendingLetter ? 'Sending…' : 'Verify & Send to Personal Email'}
                        </Button>
                      )}
                    </div>
                    {active.certificateReleasedBy && (
                      <p className="text-xs text-muted-foreground">
                        Sent by {active.certificateReleasedBy}
                        {active.closingRemarks ? ` — ${active.closingRemarks}` : ''}
                      </p>
                    )}
                  </div>
                )}
                </CardContent>
              </Card>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
