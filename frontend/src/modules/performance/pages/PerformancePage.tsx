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
import { getReferenceData, type ManagerOption } from '@/modules/employee/api'
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
  type ReviewCycle,
  type Goal,
  type Review,
  type CalibrationView,
} from '../api'

export function PerformancePage() {
  const { user } = useAuth()
  const isHrAdmin = user?.role === 'HR_ADMIN' || user?.role === 'SUPER_ADMIN'
  const isManager = user?.role === 'MANAGER'

  const [people, setPeople] = useState<ManagerOption[]>([])
  const [cycles, setCycles] = useState<ReviewCycle[]>([])
  const [selectedCycleId, setSelectedCycleId] = useState('')

  const [myGoals, setMyGoals] = useState<Goal[]>([])
  const [goalTitle, setGoalTitle] = useState('')
  const [goalTarget, setGoalTarget] = useState('')
  const [goalWeightage, setGoalWeightage] = useState('')

  const [cycleName, setCycleName] = useState('')
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

  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const weightageTotal = myGoals.reduce((sum, g) => sum + g.weightage, 0)

  useEffect(() => {
    getReferenceData().then((r) => setPeople(r.managers))
    refreshCycles()
  }, [])

  useEffect(() => {
    if (!user || !selectedCycleId) return
    refreshMyGoals(selectedCycleId)
    getReview(selectedCycleId, user.id)
      .then(setMyReview)
      .catch(() => setMyReview(null))
  }, [selectedCycleId, user])

  function refreshCycles() {
    listReviewCycles().then(setCycles).catch(() => setCycles([]))
  }

  function refreshMyGoals(cycleId: string) {
    if (!user) return
    listGoals(user.id, cycleId).then(setMyGoals).catch(() => setMyGoals([]))
  }

  function personName(id: string) {
    const p = people.find((m) => m.id === id)
    return p ? `${p.firstName} ${p.lastName}` : id
  }

  async function handleOpenCycle() {
    setError(null)
    setMessage(null)
    try {
      await openReviewCycle({ name: cycleName, periodStart, periodEnd })
      setMessage('Review cycle opened.')
      setCycleName('')
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
                  {c.name} ({c.status})
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

            {isHrAdmin && (
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
