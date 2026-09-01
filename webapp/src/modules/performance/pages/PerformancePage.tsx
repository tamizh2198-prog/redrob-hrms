"use client"

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
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
import { getReferenceData, getOrgChart, type ManagerOption } from '@/modules/employee/api'
import {
  openReviewCycle,
  listReviewCycles,
  closeReviewCycle,
  getCalibrationView,
  createGoal,
  listGoals,
  submitSelfAssessment,
  submitManagerAssessment,
  getReview,
  submitMonthlyEvaluation,
  listMonthlyEvaluations,
  auditMonthlyEvaluation,
  type ReviewCycle,
  type ReviewCycleType,
  type Goal,
  type Review,
  type CalibrationView,
  type MonthlyEvaluation,
  type PerformanceGrade,
} from '../api'

const CYCLE_TYPES: ReviewCycleType[] = ['MONTHLY', 'QUARTERLY', 'YEARLY']

// Mirrors the backend's REVIEW_CYCLE_MONTHS (performance service) — used
// only to suggest a Period End when the admin picks a Period Start/Cycle
// Type; the field stays editable so a custom boundary is still possible,
// exactly like before this field existed.
const CYCLE_TYPE_MONTHS: Record<ReviewCycleType, number> = {
  MONTHLY: 1,
  QUARTERLY: 3,
  YEARLY: 12,
}

function addMonthsToDateString(dateStr: string, months: number): string {
  const d = new Date(dateStr)
  d.setUTCMonth(d.getUTCMonth() + months)
  return d.toISOString().slice(0, 10)
}

export function PerformancePage() {
  const { user } = useAuth()
  // General HR access — mirrors HR_ADMIN except decision authority, which
  // HR Associate never gets; isSuperAdmin (below) gates the audit
  // Approve/Send-Back buttons specifically.
  const isHrAdmin = user?.role === 'HR_ADMIN' || user?.role === 'SUPER_ADMIN' || user?.role === 'HR_ASSOCIATE'
  const isSuperAdmin = user?.role === 'SUPER_ADMIN'
  const isManager = user?.role === 'MANAGER'

  const [people, setPeople] = useState<ManagerOption[]>([])
  const [directReportIds, setDirectReportIds] = useState<Set<string> | null>(null)
  const [cycles, setCycles] = useState<ReviewCycle[]>([])
  const [selectedCycleId, setSelectedCycleId] = useState('')

  const [myGoals, setMyGoals] = useState<Goal[]>([])
  const [goalTitle, setGoalTitle] = useState('')
  const [goalTarget, setGoalTarget] = useState('')
  const [goalWeightage, setGoalWeightage] = useState('')

  const [cycleName, setCycleName] = useState('')
  const [cycleType, setCycleType] = useState<ReviewCycleType>('QUARTERLY')
  const [periodStart, setPeriodStart] = useState('')
  const [periodEnd, setPeriodEnd] = useState('')

  const [reportEmployeeId, setReportEmployeeId] = useState('')
  const [managerAssessmentNotes, setManagerAssessmentNotes] = useState('')
  const [managerRating, setManagerRating] = useState('')

  const [calibration, setCalibration] = useState<CalibrationView | null>(null)
  const [myReview, setMyReview] = useState<Review | null>(null)

  const [myEvaluations, setMyEvaluations] = useState<MonthlyEvaluation[]>([])
  const [reportEvaluations, setReportEvaluations] = useState<MonthlyEvaluation[]>([])
  const [evalPeriod, setEvalPeriod] = useState('')
  const [evalKpiScore, setEvalKpiScore] = useState('')
  const [evalJustification, setEvalJustification] = useState('')
  const [auditNotesByEval, setAuditNotesByEval] = useState<Record<string, string>>({})

  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Each guards a single in-flight mutation so a slow response can't be
  // double-fired by a second click.
  const [openingCycle, setOpeningCycle] = useState(false)
  const [closingCycle, setClosingCycle] = useState(false)
  const [loadingCalibration, setLoadingCalibration] = useState(false)
  const [creatingGoal, setCreatingGoal] = useState(false)
  const [submittingSelfAssessment, setSubmittingSelfAssessment] = useState(false)
  const [submittingManagerAssessment, setSubmittingManagerAssessment] = useState(false)
  const [submittingEvaluation, setSubmittingEvaluation] = useState(false)
  const [auditing, setAuditing] = useState<{ id: string; action: 'approve' | 'sendback' } | null>(null)

  const weightageTotal = myGoals.reduce((sum, g) => sum + g.weightage, 0)

  useEffect(() => {
    getReferenceData().then((r) => setPeople(r.managers))
    refreshCycles()
    refreshMyEvaluations()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Scoring is restricted server-side to the employee's actual
  // reportingManagerId — picking someone who isn't really your report just
  // gets a 403 on submit. Narrowing this picker to real direct reports
  // avoids that confusing round-trip. HR Admin/HR Associate can also submit
  // here (they can be someone's assigned manager too), so they're narrowed
  // the same way; Super Admin keeps the full company list since it can
  // already browse anyone's scoring history regardless of reporting line.
  useEffect(() => {
    if (user?.role !== 'MANAGER' && user?.role !== 'HR_ADMIN' && user?.role !== 'HR_ASSOCIATE') return
    getOrgChart(user.id)
      .then((chart) => setDirectReportIds(new Set(chart.directReports.map((r) => r.id))))
      .catch(() => setDirectReportIds(new Set()))
  }, [user?.role, user?.id])

  const pickerOptions = directReportIds
    ? people.filter((p) => directReportIds.has(p.id))
    : people

  useEffect(() => {
    if (!user || !selectedCycleId) return
    refreshMyGoals(selectedCycleId)
    getReview(selectedCycleId, user.id)
      .then(setMyReview)
      .catch(() => setMyReview(null))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCycleId, user])

  // Suggests a Period End from Period Start + Cycle Type (Monthly=1,
  // Quarterly=3, Yearly=12 months) — the field stays editable so HR Admin
  // can still pick a custom boundary, same flexibility as before.
  useEffect(() => {
    if (!periodStart) return
    setPeriodEnd(addMonthsToDateString(periodStart, CYCLE_TYPE_MONTHS[cycleType]))
  }, [periodStart, cycleType])

  function refreshCycles() {
    listReviewCycles().then(setCycles).catch(() => setCycles([]))
  }

  function refreshMyGoals(cycleId: string) {
    if (!user) return
    listGoals(user.id, cycleId).then(setMyGoals).catch(() => setMyGoals([]))
  }

  function refreshMyEvaluations() {
    if (!user) return
    listMonthlyEvaluations(user.id).then(setMyEvaluations).catch(() => setMyEvaluations([]))
  }

  function refreshReportEvaluations() {
    if (!reportEmployeeId) return
    listMonthlyEvaluations(reportEmployeeId)
      .then(setReportEvaluations)
      .catch(() => setReportEvaluations([]))
  }

  function personName(id: string) {
    const p = people.find((m) => m.id === id)
    return p ? `${p.firstName} ${p.lastName}` : id
  }

  async function handleOpenCycle() {
    if (openingCycle) return
    setError(null)
    setMessage(null)
    setOpeningCycle(true)
    try {
      await openReviewCycle({ name: cycleName, cycleType, periodStart, periodEnd })
      setMessage('Review cycle opened.')
      setCycleName('')
      setCycleType('QUARTERLY')
      setPeriodStart('')
      setPeriodEnd('')
      refreshCycles()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to open review cycle')
    } finally {
      setOpeningCycle(false)
    }
  }

  async function handleCloseCycle() {
    if (!selectedCycleId || closingCycle) return
    setError(null)
    setMessage(null)
    setClosingCycle(true)
    try {
      const res = await closeReviewCycle(selectedCycleId)
      setMessage(`Cycle closed — ${res.reviewsFinalized} review(s) finalized.`)
      refreshCycles()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to close cycle')
    } finally {
      setClosingCycle(false)
    }
  }

  async function handleLoadCalibration() {
    if (!selectedCycleId || loadingCalibration) return
    setError(null)
    setLoadingCalibration(true)
    try {
      setCalibration(await getCalibrationView(selectedCycleId))
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load calibration view')
    } finally {
      setLoadingCalibration(false)
    }
  }

  async function handleCreateGoal() {
    if (!selectedCycleId || creatingGoal) return
    setError(null)
    setMessage(null)
    setCreatingGoal(true)
    try {
      await createGoal({
        cycleId: selectedCycleId,
        title: goalTitle,
        target: goalTarget ? Number(goalTarget) : undefined,
        weightage: Number(goalWeightage),
      })
      setGoalTitle('')
      setGoalTarget('')
      setGoalWeightage('')
      refreshMyGoals(selectedCycleId)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to add goal')
    } finally {
      setCreatingGoal(false)
    }
  }

  async function handleSubmitSelfAssessment() {
    if (!selectedCycleId || submittingSelfAssessment) return
    setError(null)
    setMessage(null)
    setSubmittingSelfAssessment(true)
    try {
      const review = await submitSelfAssessment({
        cycleId: selectedCycleId,
        assessment: { notes: 'Self-assessment submitted from the HRMS UI' },
      })
      setMyReview(review)
      setMessage('Self-assessment submitted.')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to submit self-assessment')
    } finally {
      setSubmittingSelfAssessment(false)
    }
  }

  async function handleSubmitManagerAssessment() {
    if (!selectedCycleId || !reportEmployeeId || submittingManagerAssessment) return
    setError(null)
    setMessage(null)
    setSubmittingManagerAssessment(true)
    try {
      await submitManagerAssessment({
        cycleId: selectedCycleId,
        employeeId: reportEmployeeId,
        assessment: { notes: managerAssessmentNotes },
        rating: Number(managerRating),
      })
      setMessage('Manager assessment submitted.')
      setManagerAssessmentNotes('')
      setManagerRating('')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to submit manager assessment')
    } finally {
      setSubmittingManagerAssessment(false)
    }
  }

  async function handleSubmitEvaluation() {
    if (!reportEmployeeId || !evalPeriod || submittingEvaluation) return
    setError(null)
    setMessage(null)
    setSubmittingEvaluation(true)
    try {
      await submitMonthlyEvaluation({
        employeeId: reportEmployeeId,
        period: evalPeriod,
        kpiScore: Number(evalKpiScore),
        justification: evalJustification,
      })
      setMessage('Monthly score submitted for audit.')
      setEvalKpiScore('')
      setEvalJustification('')
      refreshReportEvaluations()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to submit monthly score')
    } finally {
      setSubmittingEvaluation(false)
    }
  }

  async function handleAuditApprove(evaluationId: string) {
    if (auditing) return
    setError(null)
    setMessage(null)
    setAuditing({ id: evaluationId, action: 'approve' })
    try {
      await auditMonthlyEvaluation(evaluationId, { approve: true })
      setMessage('Score approved.')
      refreshReportEvaluations()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to approve score')
    } finally {
      setAuditing(null)
    }
  }

  async function handleAuditSendBack(evaluationId: string) {
    if (auditing) return
    setError(null)
    setMessage(null)
    setAuditing({ id: evaluationId, action: 'sendback' })
    try {
      await auditMonthlyEvaluation(evaluationId, {
        approve: false,
        auditNotes: auditNotesByEval[evaluationId] ?? '',
      })
      setMessage('Score sent back for clarification.')
      refreshReportEvaluations()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to send the score back')
    } finally {
      setAuditing(null)
    }
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <h1 className="text-xl font-semibold">Performance Management</h1>

      {message && <p className="text-sm text-primary">{message}</p>}
      {error && <p className="text-sm text-destructive">{error}</p>}

      <Card>
        <CardHeader>
          <CardTitle>Review Cycle</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-end gap-2">
            <Select value={selectedCycleId} onValueChange={(v) => setSelectedCycleId(v ?? '')}>
              <SelectTrigger className="w-64">
                <SelectValue placeholder="Select a review cycle">
                  {(v: string) => cycles.find((c) => c.id === v)?.name ?? 'Select'}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {cycles.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name} ({c.status} · {c.cycleType})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {isHrAdmin && selectedCycleId && (
              <>
                <Button size="sm" variant="outline" disabled={closingCycle} onClick={handleCloseCycle}>
                  {closingCycle ? 'Closing…' : 'Close Cycle'}
                </Button>
                <Button size="sm" variant="outline" disabled={loadingCalibration} onClick={handleLoadCalibration}>
                  {loadingCalibration ? 'Loading…' : 'Load Calibration View'}
                </Button>
              </>
            )}
          </div>

          {isHrAdmin && (
            <div className="mt-4 flex flex-wrap items-end gap-2 border-t pt-4">
              <div className="flex flex-col gap-1">
                <Label>Cycle Name</Label>
                <Input value={cycleName} onChange={(e) => setCycleName(e.target.value)} placeholder="e.g. FY26 Q1" />
              </div>
              <div className="flex flex-col gap-1">
                <Label>Cycle Type</Label>
                <Select value={cycleType} onValueChange={(v) => setCycleType((v as ReviewCycleType) ?? 'QUARTERLY')}>
                  <SelectTrigger className="w-36">
                    <SelectValue placeholder="Cycle type">{(v: string) => v}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {CYCLE_TYPES.map((t) => (
                      <SelectItem key={t} value={t}>
                        {t.charAt(0) + t.slice(1).toLowerCase()}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1">
                <Label>Period Start</Label>
                <Input type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} />
              </div>
              <div className="flex flex-col gap-1">
                <Label>Period End</Label>
                <Input type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} />
              </div>
              <Button variant="outline" disabled={openingCycle} onClick={handleOpenCycle}>
                {openingCycle ? 'Opening…' : 'Open Cycle'}
              </Button>
            </div>
          )}

          {calibration && (
            <div className="mt-4 border-t pt-4 text-sm">
              <p className="font-medium">Calibration — {calibration.totalRated} rated</p>
              <p className="mt-1 text-muted-foreground">
                By department:{' '}
                {Object.entries(calibration.byDepartment)
                  .map(([k, v]) => `${k}: ${v.average.toFixed(1)} avg (${v.count})`)
                  .join(', ') || '—'}
              </p>
              <p className="text-muted-foreground">
                By manager:{' '}
                {Object.entries(calibration.byManager)
                  .map(([k, v]) => `${personName(k)}: ${v.average.toFixed(1)} avg (${v.count})`)
                  .join(', ') || '—'}
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>My Monthly Scoring</CardTitle>
          </CardHeader>
          <CardContent>
            <MonthlyScoreChart evaluations={myEvaluations} />
            <ul className="flex flex-col gap-2 text-sm">
              {myEvaluations.map((e) => (
                <li key={e.id} className="flex items-center justify-between gap-2 rounded-md border p-2">
                  <span className="font-medium">{e.period.slice(0, 7)}</span>
                  <div className="flex items-center gap-2">
                    {e.kpiScore != null ? (
                      <>
                        <span className="text-muted-foreground">
                          {e.kpiScore} ({e.kpiPercent}%)
                        </span>
                        <Badge variant="outline">{e.grade}</Badge>
                      </>
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        {e.auditStatus === 'APPROVED'
                          ? `Approved — visible from ${e.releaseDate?.slice(0, 10)}`
                          : e.auditStatus === 'SENT_BACK'
                            ? 'Sent back to your manager'
                            : 'Pending Super Admin approval'}
                      </span>
                    )}
                    <Badge variant={e.auditStatus === 'APPROVED' ? 'default' : 'outline'}>{e.auditStatus}</Badge>
                  </div>
                </li>
              ))}
              {myEvaluations.length === 0 && <p className="text-muted-foreground">No monthly scores yet.</p>}
            </ul>
          </CardContent>
        </Card>

        {(isManager || isHrAdmin) && (
          <Card>
            <CardHeader>
              <CardTitle>Team Monthly Scoring</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col gap-2">
                <Label>Employee</Label>
                <Select
                  value={reportEmployeeId}
                  onValueChange={(v) => {
                    setReportEmployeeId(v ?? '')
                    setReportEvaluations([])
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select employee">{(v: string) => personName(v)}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {pickerOptions.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.firstName} {p.lastName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button size="sm" variant="outline" onClick={refreshReportEvaluations} className="self-start">
                  Load Scoring History
                </Button>

                <MonthlyScoreChart evaluations={reportEvaluations} />

                <ul className="flex flex-col gap-2 text-sm">
                  {reportEvaluations.map((e) => (
                    <li key={e.id} className="rounded-md border p-2">
                      <div className="flex items-center justify-between">
                        <span className="font-medium">{e.period.slice(0, 7)}</span>
                        <div className="flex items-center gap-2">
                          <Badge variant="outline">{e.grade}</Badge>
                          <Badge variant={e.auditStatus === 'APPROVED' ? 'default' : 'outline'}>{e.auditStatus}</Badge>
                        </div>
                      </div>
                      {e.kpiScore != null && (
                        <p className="text-muted-foreground">
                          Score: {e.kpiScore} ({e.kpiPercent}%) — {e.justification}
                        </p>
                      )}
                      {isSuperAdmin && e.auditStatus === 'PENDING_AUDIT' && (
                        <div className="mt-2 flex flex-wrap items-end gap-2">
                          <Button
                            size="sm"
                            variant="success"
                            disabled={auditing !== null}
                            onClick={() => handleAuditApprove(e.id)}
                          >
                            {auditing?.id === e.id && auditing.action === 'approve' ? 'Approving…' : 'Approve'}
                          </Button>
                          <Input
                            placeholder="Notes for send-back"
                            value={auditNotesByEval[e.id] ?? ''}
                            onChange={(ev) =>
                              setAuditNotesByEval((s) => ({ ...s, [e.id]: ev.target.value }))
                            }
                          />
                          <Button
                            size="sm"
                            variant="destructive"
                            disabled={auditing !== null}
                            onClick={() => handleAuditSendBack(e.id)}
                          >
                            {auditing?.id === e.id && auditing.action === 'sendback' ? 'Sending back…' : 'Send Back'}
                          </Button>
                        </div>
                      )}
                    </li>
                  ))}
                  {reportEvaluations.length === 0 && (
                    <p className="text-muted-foreground">No scores yet for this employee.</p>
                  )}
                </ul>

                {(isManager || isHrAdmin) && (
                  <div className="mt-2 flex flex-wrap items-end gap-2 border-t pt-3">
                    <div className="flex flex-col gap-1">
                      <Label>Month</Label>
                      <Input type="date" value={evalPeriod} onChange={(e) => setEvalPeriod(e.target.value)} />
                    </div>
                    <Input
                      placeholder="Score (0-1000)"
                      type="number"
                      value={evalKpiScore}
                      onChange={(e) => setEvalKpiScore(e.target.value)}
                      className="w-40"
                    />
                    <Textarea
                      placeholder="Justification"
                      value={evalJustification}
                      onChange={(e) => setEvalJustification(e.target.value)}
                    />
                    <Button size="sm" variant="outline" disabled={submittingEvaluation} onClick={handleSubmitEvaluation}>
                      {submittingEvaluation ? 'Submitting…' : 'Submit for Audit'}
                    </Button>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {selectedCycleId && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="flex flex-col gap-4">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>My Goals</CardTitle>
                  <Badge variant={Math.abs(weightageTotal - 100) < 0.01 ? 'default' : 'outline'}>
                    Weightage: {weightageTotal}%
                  </Badge>
                </div>
              </CardHeader>
              <CardContent>
                <ul className="flex flex-col gap-2 text-sm">
                  {myGoals.map((g) => (
                    <li key={g.id} className="rounded-md border p-2">
                      <div className="flex items-center justify-between">
                        <span className="font-medium">{g.title}</span>
                        <span className="text-muted-foreground">{g.weightage}%</span>
                      </div>
                      <p className="text-muted-foreground">
                        Progress: {g.actual}
                        {g.target != null ? ` / ${g.target}` : ''}
                      </p>
                    </li>
                  ))}
                  {myGoals.length === 0 && <p className="text-muted-foreground">No goals yet for this cycle.</p>}
                </ul>

                <div className="mt-3 flex flex-wrap items-end gap-2 border-t pt-3">
                  <Input placeholder="Goal title" value={goalTitle} onChange={(e) => setGoalTitle(e.target.value)} />
                  <Input
                    placeholder="Target"
                    type="number"
                    value={goalTarget}
                    onChange={(e) => setGoalTarget(e.target.value)}
                    className="w-24"
                  />
                  <Input
                    placeholder="Weightage %"
                    type="number"
                    value={goalWeightage}
                    onChange={(e) => setGoalWeightage(e.target.value)}
                    className="w-28"
                  />
                  <Button size="sm" variant="outline" disabled={creatingGoal} onClick={handleCreateGoal}>
                    {creatingGoal ? 'Adding…' : 'Add Goal'}
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>My Assessment</CardTitle>
              </CardHeader>
              <CardContent>
                {myReview && (
                  <Badge variant="outline" className="mb-2">
                    {myReview.status}
                    {myReview.finalRating != null ? ` — rating ${myReview.finalRating}` : ''}
                  </Badge>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleSubmitSelfAssessment}
                  disabled={Math.abs(weightageTotal - 100) > 0.01 || submittingSelfAssessment}
                >
                  {submittingSelfAssessment ? 'Submitting…' : 'Submit Self-Assessment'}
                </Button>
                {Math.abs(weightageTotal - 100) > 0.01 && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Goal weightages must sum to 100% before submitting.
                  </p>
                )}
              </CardContent>
            </Card>
          </div>

          {(isManager || isHrAdmin) && (
            <Card>
              <CardHeader>
                <CardTitle>Assess a Report</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-col gap-2">
                  <Label>Employee</Label>
                  <Select value={reportEmployeeId} onValueChange={(v) => setReportEmployeeId(v ?? '')}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select employee">{(v: string) => personName(v)}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {people.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.firstName} {p.lastName}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Textarea
                    placeholder="Assessment notes"
                    value={managerAssessmentNotes}
                    onChange={(e) => setManagerAssessmentNotes(e.target.value)}
                  />
                  <Input
                    placeholder="Rating (e.g. 1-5)"
                    type="number"
                    value={managerRating}
                    onChange={(e) => setManagerRating(e.target.value)}
                  />
                  <Button variant="outline" disabled={submittingManagerAssessment} onClick={handleSubmitManagerAssessment}>
                    {submittingManagerAssessment ? 'Submitting…' : 'Submit Manager Assessment'}
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  )
}

// Grade -> color, used by both the chart bars and the legend below. Chosen
// to read as a clear "good to concerning" gradient at a glance rather than
// a single flat color.
const GRADE_COLORS: Record<PerformanceGrade, string> = {
  FEE: '#16a34a', // green — Far Exceeds Expectations
  EE: '#0d9488', // teal — Exceeds Expectations
  ME: '#2563eb', // blue — Meets Expectations
  PME: '#d97706', // amber — Partially Meets Expectations
  DNME: '#dc2626', // red — Does Not Meet Expectations
}

const GRADE_LABELS: Record<PerformanceGrade, string> = {
  FEE: 'Far Exceeds',
  EE: 'Exceeds',
  ME: 'Meets',
  PME: 'Partially Meets',
  DNME: 'Does Not Meet',
}

// Colourful month-by-month progress chart — each bar is colored by that
// month's grade (not a flat single color) so a trend of improving/declining
// performance is readable at a glance, with a legend explaining the colors.
// A month that's approved-but-not-yet-released, or still pending audit,
// renders as a muted placeholder bar instead of leaking a color/grade.
// No charting library in this codebase — a handful of colored divs is
// simpler than pulling one in for a single bar-per-month view.
function MonthlyScoreChart({ evaluations }: { evaluations: MonthlyEvaluation[] }) {
  if (evaluations.length === 0) return null
  // Chronological (oldest first) reads left-to-right like a normal trend line.
  const ordered = [...evaluations].reverse()
  const gradesShown = new Set(
    ordered.filter((e) => e.kpiScore != null && e.grade).map((e) => e.grade as PerformanceGrade),
  )

  return (
    <div className="mb-3 flex flex-col gap-2">
      <div className="flex h-28 items-end gap-1.5">
        {ordered.map((e) => {
          const visible = e.kpiScore != null && e.grade != null
          return (
            <div
              key={e.id}
              className="flex flex-1 flex-col items-center gap-1"
              title={visible ? `${e.kpiScore} / 1000 (${e.grade})` : 'Not yet visible'}
            >
              <span className="text-[10px] text-muted-foreground">{visible ? e.kpiScore : '—'}</span>
              <div
                className="w-full rounded-t"
                style={{
                  height: `${Math.max(4, ((e.kpiScore ?? 40) / 1000) * 100)}%`,
                  backgroundColor: visible ? GRADE_COLORS[e.grade as PerformanceGrade] : 'var(--muted)',
                }}
              />
            </div>
          )
        })}
      </div>
      <div className="flex gap-1.5">
        {ordered.map((e) => (
          <span key={e.id} className="flex-1 text-center text-[10px] text-muted-foreground">
            {e.period.slice(2, 7)}
          </span>
        ))}
      </div>
      {gradesShown.size > 0 && (
        <div className="flex flex-wrap gap-x-3 gap-y-1 border-t pt-2">
          {(Object.keys(GRADE_COLORS) as PerformanceGrade[])
            .filter((g) => gradesShown.has(g))
            .map((g) => (
              <span key={g} className="flex items-center gap-1 text-[10px] text-muted-foreground">
                <span className="size-2 rounded-full" style={{ backgroundColor: GRADE_COLORS[g] }} />
                {GRADE_LABELS[g]}
              </span>
            ))}
        </div>
      )}
    </div>
  )
}
