import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { FileText } from 'lucide-react'
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
import { getReferenceData, type ManagerOption, type ReferenceOption } from '@/modules/employee/api'
import { getProgress, type OnboardingProgress } from '@/modules/onboarding/api'
import { OfferTemplateManager } from '../components/OfferTemplateManager'
import {
  createRequisition,
  approveRequisition,
  publishRequisition,
  listRequisitions,
  createCandidate,
  listCandidates,
  moveCandidateStage,
  scheduleInterview,
  submitScorecard,
  createOffer,
  approveOffer,
  sendOffer,
  getRequisitionAnalytics,
  listOfferTemplates,
  type JobRequisition,
  type Candidate,
  type CandidateStage,
  type PipelineAnalytics,
  type OfferTemplate,
} from '../api'

const STAGES: CandidateStage[] = ['APPLIED', 'SCREENING', 'INTERVIEW', 'OFFER', 'HIRED', 'REJECTED']

export function AtsPage() {
  const { user } = useAuth()
  // General HR access — mirrors HR_ADMIN except decision authority, which
  // HR Associate never gets; canApprove (below) gates the requisition/offer
  // Approve buttons specifically.
  const isHrAdmin = user?.role === 'HR_ADMIN' || user?.role === 'SUPER_ADMIN' || user?.role === 'HR_ASSOCIATE'
  const canApprove = user?.role === 'HR_ADMIN' || user?.role === 'SUPER_ADMIN'
  const canRaiseRequisition = isHrAdmin || user?.role === 'MANAGER'

  const [departments, setDepartments] = useState<ReferenceOption[]>([])
  const [people, setPeople] = useState<ManagerOption[]>([])
  const [requisitions, setRequisitions] = useState<JobRequisition[]>([])
  const [selectedRequisitionId, setSelectedRequisitionId] = useState<string | null>(null)
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [analytics, setAnalytics] = useState<PipelineAnalytics | null>(null)

  const [reqTitle, setReqTitle] = useState('')
  const [reqDepartmentId, setReqDepartmentId] = useState('')
  const [reqHiringManagerId, setReqHiringManagerId] = useState('')

  const [candName, setCandName] = useState('')
  const [candEmail, setCandEmail] = useState('')
  const [candPhone, setCandPhone] = useState('')
  const [candResumeRef, setCandResumeRef] = useState('')

  const [offerTemplates, setOfferTemplates] = useState<OfferTemplate[]>([])
  const [templateIdByOffer, setTemplateIdByOffer] = useState<Record<string, string>>({})

  const [preboardingByEmployee, setPreboardingByEmployee] = useState<
    Record<string, OnboardingProgress | 'none'>
  >({})

  const [lastRoundByCandidate, setLastRoundByCandidate] = useState<Record<string, string>>({})
  const [interviewerByCandidate, setInterviewerByCandidate] = useState<Record<string, string>>({})
  const [scheduledAtByCandidate, setScheduledAtByCandidate] = useState<Record<string, string>>({})
  const [recommendationByCandidate, setRecommendationByCandidate] = useState<Record<string, string>>({})
  const [ctcByCandidate, setCtcByCandidate] = useState<Record<string, string>>({})
  const [offerByCandidate, setOfferByCandidate] = useState<Record<string, string>>({})
  const [responseLinkByOffer, setResponseLinkByOffer] = useState<Record<string, string>>({})

  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    getReferenceData().then((r) => {
      setDepartments(r.departments)
      setPeople(r.managers)
    })
    refreshRequisitions()
    if (isHrAdmin) refreshOfferTemplates()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function refreshOfferTemplates() {
    listOfferTemplates().then(setOfferTemplates).catch(() => setOfferTemplates([]))
  }

  function refreshRequisitions() {
    listRequisitions().then(setRequisitions).catch(() => setRequisitions([]))
  }

  function refreshCandidates(requisitionId: string) {
    listCandidates(requisitionId)
      .then((list) => {
        setCandidates(list)
        // Preboarding status for every accepted offer's new hire — 404
        // (no checklist yet) is a real, displayable state, not an error.
        for (const c of list) {
          const employeeId = c.offers[0]?.createdEmployeeId
          if (c.offers[0]?.status === 'ACCEPTED' && employeeId) {
            getProgress(employeeId)
              .then((progress) =>
                setPreboardingByEmployee((s) => ({ ...s, [employeeId]: progress })),
              )
              .catch(() =>
                setPreboardingByEmployee((s) => ({ ...s, [employeeId]: 'none' })),
              )
          }
        }
      })
      .catch(() => setCandidates([]))
    getRequisitionAnalytics(requisitionId).then(setAnalytics).catch(() => setAnalytics(null))
  }

  function selectRequisition(id: string) {
    setSelectedRequisitionId(id)
    refreshCandidates(id)
  }

  function personName(id: string) {
    const p = people.find((m) => m.id === id)
    return p ? `${p.firstName} ${p.lastName}` : id
  }

  async function handleCreateRequisition() {
    setError(null)
    setMessage(null)
    try {
      await createRequisition({
        title: reqTitle,
        departmentId: reqDepartmentId,
        hiringManagerId: reqHiringManagerId,
      })
      setMessage('Requisition raised — pending HR/Finance approval.')
      setReqTitle('')
      refreshRequisitions()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to raise requisition')
    }
  }

  async function handleApprove(id: string) {
    setError(null)
    try {
      await approveRequisition(id)
      refreshRequisitions()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to approve requisition')
    }
  }

  async function handlePublish(id: string) {
    setError(null)
    try {
      await publishRequisition(id)
      refreshRequisitions()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to publish requisition')
    }
  }

  async function handleAddCandidate() {
    if (!selectedRequisitionId) return
    setError(null)
    setMessage(null)
    try {
      await createCandidate({
        requisitionId: selectedRequisitionId,
        name: candName,
        email: candEmail,
        phone: candPhone || undefined,
        resumeRef: candResumeRef || undefined,
        source: 'manual',
      })
      setMessage('Candidate added.')
      setCandName('')
      setCandEmail('')
      setCandPhone('')
      setCandResumeRef('')
      refreshCandidates(selectedRequisitionId)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to add candidate')
    }
  }

  async function handleMoveStage(candidateId: string, stage: CandidateStage) {
    setError(null)
    try {
      await moveCandidateStage(candidateId, stage)
      if (selectedRequisitionId) refreshCandidates(selectedRequisitionId)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to move candidate stage')
    }
  }

  async function handleScheduleInterview(candidateId: string) {
    setError(null)
    try {
      const round = await scheduleInterview(candidateId, {
        interviewerId: interviewerByCandidate[candidateId],
        scheduledAt: new Date(scheduledAtByCandidate[candidateId]).toISOString(),
      })
      setLastRoundByCandidate((s) => ({ ...s, [candidateId]: round.id }))
      setMessage('Interview scheduled.')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to schedule interview')
    }
  }

  async function handleSubmitScorecard(candidateId: string) {
    const roundId = lastRoundByCandidate[candidateId]
    if (!roundId) return
    setError(null)
    try {
      await submitScorecard(roundId, {
        scorecard: { notes: recommendationByCandidate[candidateId] ?? '' },
        recommendation: recommendationByCandidate[candidateId],
      })
      setMessage('Scorecard submitted.')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to submit scorecard')
    }
  }

  async function handleCreateOffer(candidateId: string) {
    const ctcLpa = Number(ctcByCandidate[candidateId])
    if (!ctcByCandidate[candidateId] || Number.isNaN(ctcLpa) || ctcLpa <= 0) {
      setError('Enter a valid CTC (LPA) before creating the offer')
      return
    }
    setError(null)
    setMessage(null)
    try {
      const offer = await createOffer({ candidateId, ctcBreakup: { ctcLpa } })
      setOfferByCandidate((s) => ({ ...s, [candidateId]: offer.id }))
      setMessage('Offer created.')
      if (selectedRequisitionId) refreshCandidates(selectedRequisitionId)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create offer')
    }
  }

  async function handleApproveOffer(offerId: string) {
    setError(null)
    try {
      await approveOffer(offerId)
      setMessage('Offer sign-off recorded.')
      if (selectedRequisitionId) refreshCandidates(selectedRequisitionId)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to approve offer')
    }
  }

  async function handleSendOffer(offerId: string) {
    setError(null)
    try {
      const { responseLink } = await sendOffer(offerId, templateIdByOffer[offerId] || undefined)
      setResponseLinkByOffer((s) => ({ ...s, [offerId]: responseLink }))
      setMessage('Offer sent — the candidate has also been emailed the response link.')
      if (selectedRequisitionId) refreshCandidates(selectedRequisitionId)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to send offer')
    }
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <h1 className="text-xl font-semibold">Recruitment (ATS)</h1>

      {message && <p className="text-sm text-primary">{message}</p>}
      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="flex flex-col gap-4">
          <div className="rounded-md border p-4">
            <h2 className="mb-2 font-medium">Requisitions</h2>
            <ul className="flex flex-col gap-2 text-sm">
              {requisitions.map((r) => (
                <li key={r.id} className="flex flex-col gap-1 rounded border p-2">
                  <button
                    className="text-left font-medium hover:underline"
                    onClick={() => selectRequisition(r.id)}
                  >
                    {r.title}
                  </button>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">{r.status}</Badge>
                    <span className="text-muted-foreground">Headcount: {r.headcount}</span>
                  </div>
                  <span className="text-muted-foreground">
                    Hiring Manager: {personName(r.hiringManagerId)}
                  </span>
                  {canApprove && r.status === 'PENDING_APPROVAL' && (
                    <Button size="sm" variant="outline" onClick={() => handleApprove(r.id)}>
                      Approve
                    </Button>
                  )}
                  {isHrAdmin && r.status === 'APPROVED' && (
                    <Button size="sm" variant="outline" onClick={() => handlePublish(r.id)}>
                      Publish
                    </Button>
                  )}
                </li>
              ))}
              {requisitions.length === 0 && (
                <p className="text-muted-foreground">No requisitions yet.</p>
              )}
            </ul>
          </div>

          {canRaiseRequisition && (
            <div className="rounded-md border p-4">
              <h2 className="mb-2 font-medium">Raise Requisition</h2>
              <div className="flex flex-col gap-2">
                <Label>Title</Label>
                <Input value={reqTitle} onChange={(e) => setReqTitle(e.target.value)} />
                <Label>Department</Label>
                <Select value={reqDepartmentId} onValueChange={setReqDepartmentId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select department">
                      {(value: string) => departments.find((d) => d.id === value)?.name ?? 'Select'}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {departments.map((d) => (
                      <SelectItem key={d.id} value={d.id}>
                        {d.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Label>Hiring Manager</Label>
                <Select value={reqHiringManagerId} onValueChange={setReqHiringManagerId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select hiring manager">
                      {(value: string) => personName(value)}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {people.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.firstName} {p.lastName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button variant="outline" onClick={handleCreateRequisition}>
                  Raise Requisition
                </Button>
              </div>
            </div>
          )}

          {isHrAdmin && (
            <OfferTemplateManager templates={offerTemplates} onChange={refreshOfferTemplates} />
          )}
        </div>

        <div className="flex flex-col gap-4">
          {!selectedRequisitionId && (
            <p className="text-muted-foreground">Select a requisition to see its pipeline.</p>
          )}

          {selectedRequisitionId && (
            <>
              {(() => {
                const requisition = requisitions.find((r) => r.id === selectedRequisitionId)
                if (!requisition) return null
                return (
                  <p className="text-sm text-muted-foreground">
                    Pipeline for <span className="font-medium text-foreground">{requisition.title}</span>{' '}
                    — Hiring Manager: {personName(requisition.hiringManagerId)}
                  </p>
                )
              })()}

              {analytics && (
                <div className="rounded-md border p-4 text-sm">
                  <h2 className="mb-2 font-medium">Pipeline Analytics</h2>
                  <p>Total candidates: {analytics.totalCandidates}</p>
                  <p>Time to fill: {analytics.timeToFillDays ?? '—'} days</p>
                  <p>
                    By stage:{' '}
                    {STAGES.map((s) => `${s}: ${analytics.byStage[s] ?? 0}`).join(', ')}
                  </p>
                </div>
              )}

              <div className="rounded-md border p-4">
                <h2 className="mb-2 font-medium">Add Candidate</h2>
                <div className="flex flex-wrap items-end gap-2">
                  <Input placeholder="Name" value={candName} onChange={(e) => setCandName(e.target.value)} />
                  <Input
                    placeholder="Email"
                    value={candEmail}
                    onChange={(e) => setCandEmail(e.target.value)}
                  />
                  <Input
                    placeholder="Phone"
                    value={candPhone}
                    onChange={(e) => setCandPhone(e.target.value)}
                  />
                  <Input
                    placeholder="Resume link"
                    value={candResumeRef}
                    onChange={(e) => setCandResumeRef(e.target.value)}
                  />
                  <Button variant="outline" onClick={handleAddCandidate}>
                    Add
                  </Button>
                </div>
              </div>

              <div className="flex flex-col gap-3">
                {candidates.map((c) => (
                  <div key={c.id} className="rounded-md border p-4 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="font-medium">
                        {c.name} <span className="text-muted-foreground">({c.email})</span>
                      </span>
                      <Badge variant="outline">{c.currentStage}</Badge>
                    </div>
                    {c.resumeRef ? (
                      <a
                        href={c.resumeRef}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-1 inline-flex items-center gap-1 text-primary hover:underline"
                      >
                        <FileText className="size-3.5" /> View Resume / CV
                      </a>
                    ) : (
                      <p className="mt-1 text-muted-foreground">No resume on file.</p>
                    )}
                    {c.duplicateOfId && (
                      <p className="mt-1 text-destructive">
                        Possible duplicate of an earlier applicant.
                      </p>
                    )}

                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <Select
                        value={c.currentStage}
                        onValueChange={(v) => handleMoveStage(c.id, v as CandidateStage)}
                      >
                        <SelectTrigger className="w-40">
                          <SelectValue placeholder="Stage">{(v: string) => v}</SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          {STAGES.map((s) => (
                            <SelectItem key={s} value={s}>
                              {s}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="mt-3 flex flex-wrap items-end gap-2">
                      <Select
                        value={interviewerByCandidate[c.id] ?? ''}
                        onValueChange={(v) =>
                          setInterviewerByCandidate((s) => ({ ...s, [c.id]: v }))
                        }
                      >
                        <SelectTrigger className="w-40">
                          <SelectValue placeholder="Interviewer">
                            {(v: string) => personName(v)}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          {people.map((p) => (
                            <SelectItem key={p.id} value={p.id}>
                              {p.firstName} {p.lastName}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Input
                        type="datetime-local"
                        value={scheduledAtByCandidate[c.id] ?? ''}
                        onChange={(e) =>
                          setScheduledAtByCandidate((s) => ({ ...s, [c.id]: e.target.value }))
                        }
                      />
                      <Button size="sm" variant="outline" onClick={() => handleScheduleInterview(c.id)}>
                        Schedule Interview
                      </Button>
                    </div>

                    {lastRoundByCandidate[c.id] && (
                      <div className="mt-3 flex flex-wrap items-end gap-2">
                        <Input
                          placeholder="Recommendation / notes"
                          value={recommendationByCandidate[c.id] ?? ''}
                          onChange={(e) =>
                            setRecommendationByCandidate((s) => ({ ...s, [c.id]: e.target.value }))
                          }
                        />
                        <Button size="sm" variant="outline" onClick={() => handleSubmitScorecard(c.id)}>
                          Submit Scorecard
                        </Button>
                      </div>
                    )}

                    {isHrAdmin && c.currentStage === 'OFFER' && (
                      <div className="mt-3 flex flex-col gap-2">
                        <Label>CTC (LPA)</Label>
                        <Input
                          type="number"
                          min={0}
                          step="0.1"
                          placeholder="e.g. 12"
                          className="w-40"
                          value={ctcByCandidate[c.id] ?? ''}
                          onChange={(e) =>
                            setCtcByCandidate((s) => ({ ...s, [c.id]: e.target.value }))
                          }
                        />
                        <Button size="sm" variant="outline" onClick={() => handleCreateOffer(c.id)}>
                          Create Offer
                        </Button>
                      </div>
                    )}

                    {/* Reads from the candidate's own offer history (not
                        just this session's local state), so the full offer
                        flow — approvals, sent/accepted, the employee it
                        created — stays visible to Super Admin/HR Admin/the
                        hiring manager even after a page reload or for
                        whoever opens this pipeline next. */}
                    {c.offers.length > 0 &&
                      (() => {
                        const offer = offerByCandidate[c.id]
                          ? c.offers.find((o) => o.id === offerByCandidate[c.id]) ?? c.offers[0]
                          : c.offers[0]
                        const responseLink = responseLinkByOffer[offer.id]
                        const preboarding = offer.createdEmployeeId
                          ? preboardingByEmployee[offer.createdEmployeeId]
                          : undefined
                        return (
                          <div className="mt-3 flex flex-col gap-2 rounded-md border border-dashed p-3">
                            <div className="flex items-center gap-2">
                              <span className="font-medium">Offer:</span>
                              <Badge variant="outline">{offer.status}</Badge>
                            </div>
                            <ul className="flex flex-col gap-0.5 text-xs text-muted-foreground">
                              <li>
                                HR / CTC approval (HR Admin/Super Admin only):{' '}
                                {offer.hrApprovedAt ? '✓ approved' : 'pending'}
                              </li>
                              {offer.sentAt && <li>Sent to candidate: {offer.sentAt.slice(0, 10)}</li>}
                              {offer.acceptedAt && (
                                <li>Accepted: {offer.acceptedAt.slice(0, 10)}</li>
                              )}
                            </ul>
                            <div className="flex flex-wrap gap-2">
                              {canApprove && offer.status === 'DRAFT' && !offer.hrApprovedAt && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => handleApproveOffer(offer.id)}
                                >
                                  Approve
                                </Button>
                              )}
                              {isHrAdmin && offer.hrApprovedAt && offer.status === 'DRAFT' && (
                                <div className="flex flex-col gap-2">
                                  <Label>Offer letter template</Label>
                                  <Select
                                    value={templateIdByOffer[offer.id] ?? ''}
                                    onValueChange={(v) =>
                                      setTemplateIdByOffer((s) => ({ ...s, [offer.id]: v }))
                                    }
                                  >
                                    <SelectTrigger className="w-56">
                                      <SelectValue placeholder="Default letter">
                                        {(v: string) =>
                                          offerTemplates.find((t) => t.id === v)?.name ??
                                          'Default letter'
                                        }
                                      </SelectValue>
                                    </SelectTrigger>
                                    <SelectContent>
                                      {offerTemplates.map((t) => (
                                        <SelectItem key={t.id} value={t.id}>
                                          {t.name} {t.isDefault ? '(default)' : ''}
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => handleSendOffer(offer.id)}
                                  >
                                    Send Offer
                                  </Button>
                                </div>
                              )}
                            </div>
                            {responseLink && (
                              <p className="break-all text-xs text-muted-foreground">
                                Candidate response link: {responseLink}
                              </p>
                            )}
                            {offer.status === 'ACCEPTED' && offer.createdEmployeeId && (
                              <>
                                <Link
                                  className="text-xs text-primary hover:underline"
                                  to={`/employee/${offer.createdEmployeeId}`}
                                >
                                  View the new hire's employee record →
                                </Link>
                                <p className="text-xs text-muted-foreground">
                                  Preboarding:{' '}
                                  {preboarding === undefined && 'Loading…'}
                                  {preboarding === 'none' &&
                                    'Not started — HR can run "Init checklist" from the Onboarding module.'}
                                  {preboarding &&
                                    preboarding !== 'none' &&
                                    `${preboarding.checklist.status} (${preboarding.completionPercent}% complete)`}
                                </p>
                              </>
                            )}
                          </div>
                        )
                      })()}
                  </div>
                ))}
                {candidates.length === 0 && (
                  <p className="text-muted-foreground">No candidates for this requisition yet.</p>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
