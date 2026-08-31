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
  correctRating,
  getReview,
  submitMonthlyEvaluation,
  listMonthlyEvaluations,
  auditMonthlyEvaluation,
  listQuarterlyKpiRewards,
  submitQuarterlyKpi,
  listQuarterlyKpis,
  auditQuarterlyKpi,
  type ReviewCycle,
  type ReviewCycleType,
  type Goal,
  type Review,
  type CalibrationView,
  type MonthlyEvaluation,
  type QuarterlyKpiRewardsResponse,
  type QuarterlyKpiRating,
} from '../api'

const CYCLE_TYPES: ReviewCycleType[] = ['MONTHLY', 'QUARTERLY', 'YEARLY']

// Mirrors the backend's REVIEW_CYCLE_MONTHS (performance.service.ts) — used
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
  // HR Associate never gets; canApprove (below) gates those call sites
  // specifically (Correct a Finalized Rating).
  const isHrAdmin = user?.role === 'HR_ADMIN' || user?.role === 'SUPER_ADMIN' || user?.role === 'HR_ASSOCIATE'
  const isSuperAdmin = user?.role === 'SUPER_ADMIN'
  const isManager = user?.role === 'MANAGER'
  const canApprove = user?.role === 'HR_ADMIN' || user?.role === 'SUPER_ADMIN'

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

  const [correctReviewId, setCorrectReviewId] = useState('')
  const [correctNewRating, setCorrectNewRating] = useState('')
  const [correctReason, setCorrectReason] = useState('')

  const [calibration, setCalibration] = useState<CalibrationView | null>(null)
  const [myReview, setMyReview] = useState<Review | null>(null)

  const [myEvaluations, setMyEvaluations] = useState<MonthlyEvaluation[]>([])
  const [reportEvaluations, setReportEvaluations] = useState<MonthlyEvaluation[]>([])
  const [myRewards, setMyRewards] = useState<QuarterlyKpiRewardsResponse | null>(null)
  const [reportRewards, setReportRewards] = useState<QuarterlyKpiRewardsResponse | null>(null)
  const [evalPeriod, setEvalPeriod] = useState('')
  const [evalKpiScore, setEvalKpiScore] = useState('')
  const [evalJustification, setEvalJustification] = useState('')
  const [auditNotesByEval, setAuditNotesByEval] = useState<Record<string, string>>({})

  const [myQuarterlyKpis, setMyQuarterlyKpis] = useState<QuarterlyKpiRating[]>([])
  const [reportQuarterlyKpis, setReportQuarterlyKpis] = useState<QuarterlyKpiRating[]>([])
  const [kpiYear, setKpiYear] = useState(String(new Date().getFullYear()))
  const [kpiQuarter, setKpiQuarter] = useState('1')
  const [kpiPercent, setKpiPercent] = useState('')
  const [kpiJustification, setKpiJustification] = useState('')

  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const weightageTotal = myGoals.reduce((sum, g) => sum + g.weightage, 0)

  useEffect(() => {
    getReferenceData().then((r) => setPeople(r.managers))
    refreshCycles()
    refreshMyEvaluations()
  }, [])

  // Scoring (both monthly KPI evaluations and manager assessments) is
  // restricted server-side to the employee's actual reportingManagerId —
  // picking someone who isn't really your report just gets a 403 on
  // submit. Narrowing this picker to real direct reports avoids that
  // confusing round-trip. HR Admin/HR Associate can also submit here now
  // (they can be someone's assigned manager too), so they're narrowed the
  // same way; Super Admin keeps the full company list since it can already
  // browse/audit anyone's evaluations regardless of reporting line.
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
    listQuarterlyKpiRewards(user.id, new Date().getFullYear())
      .then(setMyRewards)
      .catch(() => setMyRewards(null))
    listQuarterlyKpis(user.id).then(setMyQuarterlyKpis).catch(() => setMyQuarterlyKpis([]))
  }

  function refreshReportEvaluations() {
    if (!reportEmployeeId) return
    listMonthlyEvaluations(reportEmployeeId)
      .then(setReportEvaluations)
      .catch(() => setReportEvaluations([]))
    listQuarterlyKpiRewards(reportEmployeeId, new Date().getFullYear())
      .then(setReportRewards)
      .catch(() => setReportRewards(null))
    listQuarterlyKpis(reportEmployeeId)
      .then(setReportQuarterlyKpis)
      .catch(() => setReportQuarterlyKpis([]))
  }

  function personName(id: string) {
    const p = people.find((m) => m.id === id)
    return p ? `${p.firstName} ${p.lastName}` : id
  }

  async function handleOpenCycle() {
    setError(null)
    setMessage(null)
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
    }
  }

  async function handleCloseCycle() {
    if (!selectedCycleId) return
    setError(null)
    setMessage(null)
    try {
      const res = await closeReviewCycle(selectedCycleId)
      setMessage(`Cycle closed — ${res.reviewsFinalized} review(s) finalized.`)
      refreshCycles()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to close cycle')
    }
  }

  async function handleLoadCalibration() {
    if (!selectedCycleId) return
    setError(null)
    try {
      setCalibration(await getCalibrationView(selectedCycleId))
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load calibration view')
    }
  }

  async function handleCreateGoal() {
    if (!selectedCycleId) return
    setError(null)
    setMessage(null)
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
    }
  }

  async function handleSubmitSelfAssessment() {
    if (!selectedCycleId) return
    setError(null)
    setMessage(null)
    try {
      const review = await submitSelfAssessment({
        cycleId: selectedCycleId,
        assessment: { notes: 'Self-assessment submitted from the HRMS UI' },
      })
      setMyReview(review)
      setMessage('Self-assessment submitted.')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to submit self-assessment')
    }
  }

  async function handleSubmitManagerAssessment() {
    if (!selectedCycleId || !reportEmployeeId) return
    setError(null)
    setMessage(null)
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
    }
  }

  async function handleCorrectRating() {
    if (!correctReviewId) return
    setError(null)
    setMessage(null)
    try {
      await correctRating(correctReviewId, {
        newRating: Number(correctNewRating),
        reason: correctReason,
      })
      setMessage('Correction recorded — rating updated with an audit trail.')
      setCorrectReviewId('')
      setCorrectNewRating('')
      setCorrectReason('')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to record correction')
    }
  }

  async function handleSubmitEvaluation() {
    if (!reportEmployeeId || !evalPeriod) return
    setError(null)
    setMessage(null)
    try {
      await submitMonthlyEvaluation({
        employeeId: reportEmployeeId,
        period: evalPeriod,
        kpiScore: Number(evalKpiScore),
        justification: evalJustification,
      })
      setMessage('Monthly evaluation submitted for audit.')
      setEvalKpiScore('')
      setEvalJustification('')
      refreshReportEvaluations()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to submit monthly evaluation')
    }
  }

  async function handleAuditApprove(evaluationId: string) {
    setError(null)
    setMessage(null)
    try {
      await auditMonthlyEvaluation(evaluationId, { approve: true })
      setMessage('Evaluation approved.')
      refreshReportEvaluations()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to approve evaluation')
    }
  }

  async function handleAuditSendBack(evaluationId: string) {
    setError(null)
    setMessage(null)
    try {
      await auditMonthlyEvaluation(evaluationId, {
        approve: false,
        auditNotes: auditNotesByEval[evaluationId] ?? '',
      })
      setMessage('Evaluation sent back for clarification.')
      refreshReportEvaluations()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to send the evaluation back')
    }
  }

  async function handleSubmitQuarterlyKpi() {
    if (!reportEmployeeId) return
    setError(null)
    setMessage(null)
    try {
      await submitQuarterlyKpi({
        employeeId: reportEmployeeId,
        year: Number(kpiYear),
        quarter: Number(kpiQuarter),
        kpiPercent: Number(kpiPercent),
        justification: kpiJustification,
      })
      setMessage('Quarterly KPI submitted for audit.')
      setKpiPercent('')
      setKpiJustification('')
      refreshReportEvaluations()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to submit quarterly KPI')
    }
  }

  async function handleAuditKpiApprove(kpiId: string) {
    setError(null)
    setMessage(null)
    try {
      await auditQuarterlyKpi(kpiId, { approve: true })
      setMessage('Quarterly KPI approved.')
      refreshReportEvaluations()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to approve quarterly KPI')
    }
  }

  async function handleAuditKpiSendBack(kpiId: string) {
    setError(null)
    setMessage(null)
    try {
      await auditQuarterlyKpi(kpiId, {
        approve: false,
        auditNotes: auditNotesByEval[kpiId] ?? '',
      })
      setMessage('Quarterly KPI sent back for clarification.')
      refreshReportEvaluations()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to send the quarterly KPI back')
    }
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <h1 className="text-xl font-semibold">Performance Management</h1>

      {message && <p className="text-sm text-primary">{message}</p>}
      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="rounded-md border p-4">
        <h2 className="mb-2 font-medium">Review Cycle</h2>
        <div className="flex flex-wrap items-end gap-2">
          <Select value={selectedCycleId} onValueChange={setSelectedCycleId}>
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
              <Button size="sm" variant="outline" onClick={handleCloseCycle}>
                Close Cycle
              </Button>
              <Button size="sm" variant="outline" onClick={handleLoadCalibration}>
                Load Calibration View
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
              <Select value={cycleType} onValueChange={(v) => setCycleType(v as ReviewCycleType)}>
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
            <Button variant="outline" onClick={handleOpenCycle}>
              Open Cycle
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
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-md border p-4">
          <h2 className="mb-2 font-medium">My Monthly Evaluations</h2>
          <MonthlyScoreBarChart evaluations={myEvaluations} />
          <ul className="flex flex-col gap-2 text-sm">
            {myEvaluations.map((e) => (
              <li key={e.id} className="flex items-center justify-between rounded border p-2">
                <span>{e.period.slice(0, 7)}</span>
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
            {myEvaluations.length === 0 && <p className="text-muted-foreground">No monthly evaluations yet.</p>}
          </ul>
          <QuarterlyKpiRewardsPanel rewards={myRewards} />
          <YourKpisPanel kpis={myQuarterlyKpis} />
        </div>

        {(isManager || isHrAdmin) && (
          <div className="rounded-md border p-4">
            <h2 className="mb-2 font-medium">Monthly KPI Evaluation — Report</h2>
            <div className="flex flex-col gap-2">
              <Label>Employee</Label>
              <Select
                value={reportEmployeeId}
                onValueChange={(v) => {
                  setReportEmployeeId(v)
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
                Load Evaluation History
              </Button>

              <MonthlyScoreBarChart evaluations={reportEvaluations} />

              <ul className="flex flex-col gap-2 text-sm">
                {reportEvaluations.map((e) => (
                  <li key={e.id} className="rounded border p-2">
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
                        <Button size="sm" variant="outline" onClick={() => handleAuditApprove(e.id)}>
                          Approve
                        </Button>
                        <Input
                          placeholder="Notes for send-back"
                          value={auditNotesByEval[e.id] ?? ''}
                          onChange={(ev) =>
                            setAuditNotesByEval((s) => ({ ...s, [e.id]: ev.target.value }))
                          }
                        />
                        <Button size="sm" variant="outline" onClick={() => handleAuditSendBack(e.id)}>
                          Send Back
                        </Button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>

              <QuarterlyKpiRewardsPanel rewards={reportRewards} />

              {(isManager || isHrAdmin) && (
                <div className="mt-2 flex flex-wrap items-end gap-2 border-t pt-3">
                  <div className="flex flex-col gap-1">
                    <Label>Month</Label>
                    <Input type="date" value={evalPeriod} onChange={(e) => setEvalPeriod(e.target.value)} />
                  </div>
                  <Input
                    placeholder="KPI Score (0-1000)"
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
                  <Button size="sm" variant="outline" onClick={handleSubmitEvaluation}>
                    Submit for Audit
                  </Button>
                </div>
              )}

              <div className="mt-3 border-t pt-3">
                <h3 className="mb-2 text-sm font-medium">Quarterly KPI %</h3>
                <ul className="flex flex-col gap-2 text-sm">
                  {reportQuarterlyKpis.map((k) => (
                    <li key={k.id} className="rounded border p-2">
                      <div className="flex items-center justify-between">
                        <span className="font-medium">
                          Q{k.quarter} {k.year}
                        </span>
                        <Badge variant={k.auditStatus === 'APPROVED' ? 'default' : 'outline'}>{k.auditStatus}</Badge>
                      </div>
                      {k.kpiPercent != null && (
                        <p className="text-muted-foreground">
                          {k.kpiPercent}% — {k.justification}
                        </p>
                      )}
                      {isSuperAdmin && k.auditStatus === 'PENDING_AUDIT' && (
                        <div className="mt-2 flex flex-wrap items-end gap-2">
                          <Button size="sm" variant="outline" onClick={() => handleAuditKpiApprove(k.id)}>
                            Approve
                          </Button>
                          <Input
                            placeholder="Notes for send-back"
                            value={auditNotesByEval[k.id] ?? ''}
                            onChange={(ev) =>
                              setAuditNotesByEval((s) => ({ ...s, [k.id]: ev.target.value }))
                            }
                          />
                          <Button size="sm" variant="outline" onClick={() => handleAuditKpiSendBack(k.id)}>
                            Send Back
                          </Button>
                        </div>
                      )}
                    </li>
                  ))}
                  {reportQuarterlyKpis.length === 0 && (
                    <p className="text-muted-foreground">No quarterly KPIs yet.</p>
                  )}
                </ul>

                {(isManager || isHrAdmin) && (
                  <div className="mt-2 flex flex-wrap items-end gap-2 border-t pt-3">
                    <Input
                      placeholder="Year"
                      type="number"
                      value={kpiYear}
                      onChange={(e) => setKpiYear(e.target.value)}
                      className="w-24"
                    />
                    <Select value={kpiQuarter} onValueChange={setKpiQuarter}>
                      <SelectTrigger className="w-24">
                        <SelectValue placeholder="Quarter">{(v: string) => `Q${v}`}</SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {['1', '2', '3', '4'].map((q) => (
                          <SelectItem key={q} value={q}>
                            Q{q}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Input
                      placeholder="KPI %"
                      type="number"
                      value={kpiPercent}
                      onChange={(e) => setKpiPercent(e.target.value)}
                      className="w-24"
                    />
                    <Textarea
                      placeholder="Justification"
                      value={kpiJustification}
                      onChange={(e) => setKpiJustification(e.target.value)}
                    />
                    <Button size="sm" variant="outline" onClick={handleSubmitQuarterlyKpi}>
                      Submit for Audit
                    </Button>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {selectedCycleId && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="flex flex-col gap-4">
            <div className="rounded-md border p-4">
              <div className="mb-2 flex items-center justify-between">
                <h2 className="font-medium">My Goals</h2>
                <Badge variant={Math.abs(weightageTotal - 100) < 0.01 ? 'default' : 'outline'}>
                  Weightage: {weightageTotal}%
                </Badge>
              </div>
              <ul className="flex flex-col gap-2 text-sm">
                {myGoals.map((g) => (
                  <li key={g.id} className="rounded border p-2">
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
                <Button size="sm" variant="outline" onClick={handleCreateGoal}>
                  Add Goal
                </Button>
              </div>
            </div>

            <div className="rounded-md border p-4">
              <h2 className="mb-2 font-medium">My Assessment</h2>
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
                disabled={Math.abs(weightageTotal - 100) > 0.01}
              >
                Submit Self-Assessment
              </Button>
              {Math.abs(weightageTotal - 100) > 0.01 && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Goal weightages must sum to 100% before submitting.
                </p>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-4">
            {(isManager || isHrAdmin) && (
              <div className="rounded-md border p-4">
                <h2 className="mb-2 font-medium">Assess a Report</h2>
                <div className="flex flex-col gap-2">
                  <Label>Employee</Label>
                  <Select value={reportEmployeeId} onValueChange={setReportEmployeeId}>
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
                  <Button variant="outline" onClick={handleSubmitManagerAssessment}>
                    Submit Manager Assessment
                  </Button>
                </div>
              </div>
            )}

            {canApprove && (
              <div className="rounded-md border p-4">
                <h2 className="mb-2 font-medium">Correct a Finalized Rating</h2>
                <p className="mb-2 text-xs text-muted-foreground">
                  Only applies to reviews in a closed cycle — creates a documented, versioned correction.
                </p>
                <div className="flex flex-col gap-2">
                  <Input
                    placeholder="Review ID"
                    value={correctReviewId}
                    onChange={(e) => setCorrectReviewId(e.target.value)}
                  />
                  <Input
                    placeholder="New rating"
                    type="number"
                    value={correctNewRating}
                    onChange={(e) => setCorrectNewRating(e.target.value)}
                  />
                  <Textarea
                    placeholder="Reason for correction"
                    value={correctReason}
                    onChange={(e) => setCorrectReason(e.target.value)}
                  />
                  <Button variant="outline" onClick={handleCorrectRating}>
                    Record Correction
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// Simple CSS bar chart — monthly KPI score out of 1000. No charting library
// in this codebase yet, and a single bar-per-month view doesn't need one.
function MonthlyScoreBarChart({ evaluations }: { evaluations: MonthlyEvaluation[] }) {
  const withScores = evaluations.filter((e) => e.kpiScore != null)
  if (withScores.length === 0) return null
  // Chronological (oldest first) reads left-to-right like a normal trend line.
  const ordered = [...withScores].reverse()
  return (
    <div className="mb-3 flex flex-col gap-1">
      <div className="flex h-28 items-end gap-1.5">
        {ordered.map((e) => (
          <div key={e.id} className="flex flex-1 flex-col items-center gap-1" title={`${e.kpiScore} / 1000`}>
            <span className="text-[10px] text-muted-foreground">{e.kpiScore}</span>
            <div
              className="w-full rounded-t bg-primary"
              style={{ height: `${Math.max(4, ((e.kpiScore ?? 0) / 1000) * 100)}%` }}
            />
          </div>
        ))}
      </div>
      <div className="flex gap-1.5">
        {ordered.map((e) => (
          <span key={e.id} className="flex-1 text-center text-[10px] text-muted-foreground">
            {e.period.slice(2, 7)}
          </span>
        ))}
      </div>
    </div>
  )
}

// Items 5/6: quarterly KPI-linked reward, per P&B effective January 2026,
// "3a. Member KPI Linked Rewards" — quarterlyLimit * that quarter's average
// KPI%. Computed server-side; this just renders the breakdown.
function QuarterlyKpiRewardsPanel({ rewards }: { rewards: QuarterlyKpiRewardsResponse | null }) {
  if (!rewards) return null
  return (
    <div className="mt-3 flex flex-col gap-2 border-t pt-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">Quarterly KPI Rewards — {rewards.year}</h3>
        {rewards.ctcLpa != null && (
          <span className="text-xs text-muted-foreground">CTC band: {rewards.quarters[0]?.ctcBandLabel}</span>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {rewards.quarters.map((q) => (
          <div key={q.quarter} className="rounded border p-2 text-xs">
            <div className="font-medium">Q{q.quarter}</div>
            {q.complete ? (
              <>
                <div className="text-muted-foreground">Avg KPI: {q.avgKpiPercent}%</div>
                <div className="font-medium text-primary">₹{q.rewardAmount?.toLocaleString('en-IN')}</div>
              </>
            ) : (
              <div className="text-muted-foreground">{q.reason ?? 'Pending'}</div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

// The new employee-facing view onto their own standalone quarterly KPI%
// (see QuarterlyKpiRating) — deliberately separate from
// QuarterlyKpiRewardsPanel above so a ₹ payout and a KPI% aren't visually
// conflated. Same confidentiality contract as the monthly evaluations list:
// kpiPercent is null until approved and past its release date.
function YourKpisPanel({ kpis }: { kpis: QuarterlyKpiRating[] }) {
  if (kpis.length === 0) return null
  const byYear = new Map<number, QuarterlyKpiRating[]>()
  for (const k of kpis) {
    byYear.set(k.year, [...(byYear.get(k.year) ?? []), k])
  }
  return (
    <div className="mt-3 flex flex-col gap-2 border-t pt-3">
      <h3 className="text-sm font-medium">Your KPIs</h3>
      {[...byYear.entries()]
        .sort(([a], [b]) => b - a)
        .map(([year, yearKpis]) => (
          <div key={year} className="flex flex-col gap-1">
            <div className="text-xs font-medium text-muted-foreground">{year}</div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[...yearKpis]
                .sort((a, b) => a.quarter - b.quarter)
                .map((k) => (
                  <div key={k.id} className="rounded border p-2 text-xs">
                    <div className="font-medium">Q{k.quarter}</div>
                    {k.kpiPercent != null ? (
                      <div className="font-medium text-primary">{k.kpiPercent}%</div>
                    ) : (
                      <div className="text-muted-foreground">
                        {k.auditStatus === 'APPROVED'
                          ? `Visible from ${k.releaseDate?.slice(0, 10)}`
                          : k.auditStatus === 'SENT_BACK'
                            ? 'Sent back to your manager'
                            : 'Pending approval'}
                      </div>
                    )}
                  </div>
                ))}
            </div>
          </div>
        ))}
    </div>
  )
}
