"use client"

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
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useAuth } from '@/shared/auth/AuthContext'
import { canAccessHrOperationalModules } from '@/shared/auth/role'
import { ApiError } from '@/lib/api'
import { getReferenceData, type ManagerOption, type ReferenceOption } from '@/modules/employee/api'
import {
  listActiveChecklists,
  listTemplates,
  createTemplate,
  initChecklist,
  activateEmployee,
  completeTask,
  resendPreboardingLink,
  listProbationFeedback,
  ONBOARDING_PHASES,
  ONBOARDING_PHASE_LABELS,
  MANDATORY_FIELD_LABELS,
  type ChecklistWithEmployee,
  type OnboardingTemplate,
  type ChecklistOwnerRole,
  type OnboardingPhase,
  type ChecklistTask,
  type ProbationFeedbackWithEmployee,
} from '../api'

const OWNER_ROLES: ChecklistOwnerRole[] = ['HR', 'IT', 'MANAGER', 'NEW_HIRE']
const AUTO_DETECT_TEMPLATE = 'AUTO_DETECT'

interface TaskRow {
  ownerRole: ChecklistOwnerRole
  phase: OnboardingPhase
  description: string
  dueOffsetDays: string
}

function groupByPhase(tasks: ChecklistTask[]): Array<[OnboardingPhase, ChecklistTask[]]> {
  return ONBOARDING_PHASES.map((phase) => [phase, tasks.filter((t) => t.phase === phase)]).filter(
    ([, tasks]) => tasks.length > 0,
  ) as Array<[OnboardingPhase, ChecklistTask[]]>
}

export function OnboardingPage() {
  const { user } = useAuth()
  const isHrAdmin = canAccessHrOperationalModules(user?.role)

  const [checklists, setChecklists] = useState<ChecklistWithEmployee[]>([])
  const [templates, setTemplates] = useState<OnboardingTemplate[]>([])
  const [departments, setDepartments] = useState<ReferenceOption[]>([])
  const [people, setPeople] = useState<ManagerOption[]>([])
  const [feedback, setFeedback] = useState<ProbationFeedbackWithEmployee[]>([])

  const [templateName, setTemplateName] = useState('')
  const [templateDepartmentId, setTemplateDepartmentId] = useState('')
  const [templateIsDefault, setTemplateIsDefault] = useState(false)
  const [taskRows, setTaskRows] = useState<TaskRow[]>([
    { ownerRole: 'NEW_HIRE', phase: 'DAY_ONE', description: '', dueOffsetDays: '0' },
  ])
  const canCreateTemplate =
    templateName.trim().length > 0 &&
    taskRows.length > 0 &&
    taskRows.every((t) => t.description.trim().length > 0)

  const [initEmployeeId, setInitEmployeeId] = useState('')
  const [initTemplateId, setInitTemplateId] = useState(AUTO_DETECT_TEMPLATE)

  const preboardingPeople = people.filter((p) => p.status === 'PREBOARDING')

  const [checklistSearch, setChecklistSearch] = useState('')
  const checklistQuery = checklistSearch.trim().toLowerCase()
  const filteredChecklists = checklistQuery
    ? checklists.filter((c) =>
        `${c.employee.firstName} ${c.employee.lastName} ${c.employee.employeeCode}`
          .toLowerCase()
          .includes(checklistQuery),
      )
    : checklists

  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [portalLinkUrl, setPortalLinkUrl] = useState<string | null>(null)
  const [portalLinkCopied, setPortalLinkCopied] = useState(false)

  // Each guards a single in-flight mutation so a slow response can't be
  // double-fired by a second click.
  const [creatingTemplate, setCreatingTemplate] = useState(false)
  const [initializingChecklist, setInitializingChecklist] = useState(false)
  const [completingTaskId, setCompletingTaskId] = useState<string | null>(null)
  const [activatingId, setActivatingId] = useState<string | null>(null)
  const [sendingLinkId, setSendingLinkId] = useState<string | null>(null)

  useEffect(() => {
    getReferenceData().then((r) => {
      setDepartments(r.departments)
      setPeople(r.managers)
    })
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function refresh() {
    if (isHrAdmin) {
      listActiveChecklists().then(setChecklists).catch(() => setChecklists([]))
      listTemplates().then(setTemplates).catch(() => setTemplates([]))
      listProbationFeedback().then(setFeedback).catch(() => setFeedback([]))
    }
  }

  function addTaskRow(phase: OnboardingPhase = 'DAY_ONE') {
    setTaskRows((rows) => [...rows, { ownerRole: 'HR', phase, description: '', dueOffsetDays: '0' }])
  }

  function removeTaskRow(index: number) {
    setTaskRows((rows) => rows.filter((_, i) => i !== index))
  }

  function updateTaskRow(index: number, patch: Partial<TaskRow>) {
    setTaskRows((rows) => rows.map((r, i) => (i === index ? { ...r, ...patch } : r)))
  }

  async function handleCreateTemplate() {
    if (creatingTemplate || !canCreateTemplate) return
    setError(null)
    setMessage(null)
    setCreatingTemplate(true)
    try {
      await createTemplate({
        name: templateName.trim(),
        departmentId: templateDepartmentId || undefined,
        isDefault: templateIsDefault,
        tasks: taskRows.map((t) => ({
          ownerRole: t.ownerRole,
          phase: t.phase,
          description: t.description.trim(),
          dueOffsetDays: Number(t.dueOffsetDays) || 0,
        })),
      })
      setMessage('Onboarding template created.')
      setTemplateName('')
      setTemplateIsDefault(false)
      setTaskRows([{ ownerRole: 'NEW_HIRE', phase: 'DAY_ONE', description: '', dueOffsetDays: '0' }])
      refresh()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create template')
    } finally {
      setCreatingTemplate(false)
    }
  }

  async function handleInitChecklist() {
    if (initializingChecklist) return
    setError(null)
    setMessage(null)
    setInitializingChecklist(true)
    try {
      await initChecklist(
        initEmployeeId,
        initTemplateId === AUTO_DETECT_TEMPLATE ? undefined : initTemplateId,
      )
      setMessage('Onboarding checklist created.')
      refresh()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create checklist')
    } finally {
      setInitializingChecklist(false)
    }
  }

  async function handleCompleteTask(taskId: string) {
    if (completingTaskId) return
    setError(null)
    setCompletingTaskId(taskId)
    try {
      await completeTask(taskId)
      refresh()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to complete task')
    } finally {
      setCompletingTaskId(null)
    }
  }

  async function handleActivate(employeeId: string) {
    if (activatingId) return
    setError(null)
    setMessage(null)
    setActivatingId(employeeId)
    try {
      await activateEmployee(employeeId)
      setMessage('Employee activated.')
      refresh()
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : 'Failed to activate employee',
      )
    } finally {
      setActivatingId(null)
    }
  }

  async function handleSendPortalLink(employeeId: string) {
    if (sendingLinkId) return
    setError(null)
    setMessage(null)
    setPortalLinkUrl(null)
    setSendingLinkId(employeeId)
    try {
      const result = await resendPreboardingLink(employeeId)
      setMessage(
        result.emailSent
          ? 'Preboarding portal link emailed.'
          : "Email delivery isn't configured — copy the portal link below and send it to them directly.",
      )
      setPortalLinkUrl(result.preboardingUrl ?? null)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to send portal link')
    } finally {
      setSendingLinkId(null)
    }
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <h1 className="text-xl font-semibold">Onboarding</h1>

      {message && <p className="text-sm text-primary">{message}</p>}
      {error && <p className="text-sm text-destructive">{error}</p>}
      {portalLinkUrl && (
        <div className="flex items-center gap-2 rounded-md border bg-muted/50 p-2">
          <Input readOnly value={portalLinkUrl} className="text-xs" onFocus={(e) => e.target.select()} />
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={async () => {
              await navigator.clipboard.writeText(portalLinkUrl)
              setPortalLinkCopied(true)
              setTimeout(() => setPortalLinkCopied(false), 2000)
            }}
          >
            {portalLinkCopied ? 'Copied!' : 'Copy'}
          </Button>
        </div>
      )}

      {!isHrAdmin && (
        <p className="text-sm text-muted-foreground">
          Onboarding administration (starting checklists, managing templates) is available to HR
          Admins. You can still see progress on checklists you own tasks in.
        </p>
      )}

      {isHrAdmin && (
        <Card>
          <CardHeader>
            <CardTitle>Start Onboarding for a New Hire</CardTitle>
          </CardHeader>
          <CardContent>
          <p className="mb-2 text-sm text-muted-foreground">
            Only employees currently in Preboarding status (post-offer-accept, pre-Day-1) can have
            a checklist started — anyone else can never pass the later Activate step.
          </p>
          <div className="flex flex-wrap items-end gap-2">
            <Select value={initEmployeeId} onValueChange={(v) => setInitEmployeeId(v ?? '')}>
              <SelectTrigger className="w-56">
                <SelectValue placeholder="Select employee">
                  {(v: string) => {
                    const p = preboardingPeople.find((m) => m.id === v)
                    return p ? `${p.firstName} ${p.lastName}` : 'Select employee'
                  }}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {preboardingPeople.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.firstName} {p.lastName} ({p.employeeCode})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={initTemplateId} onValueChange={(v) => setInitTemplateId(v ?? AUTO_DETECT_TEMPLATE)}>
              <SelectTrigger className="w-64">
                <SelectValue>
                  {(v: string) =>
                    v === AUTO_DETECT_TEMPLATE
                      ? 'Auto-detect from department'
                      : (templates.find((t) => t.id === v)?.name ?? 'Auto-detect from department')
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={AUTO_DETECT_TEMPLATE}>Auto-detect from department</SelectItem>
                {templates.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" onClick={handleInitChecklist} disabled={!initEmployeeId || initializingChecklist}>
              {initializingChecklist ? 'Creating…' : 'Create Checklist'}
            </Button>
          </div>
          {preboardingPeople.length === 0 && (
            <p className="mt-2 text-sm text-muted-foreground">
              No employees are currently in Preboarding status.
            </p>
          )}
          </CardContent>
        </Card>
      )}

      {isHrAdmin && (
      <Card>
        <CardHeader>
          <CardTitle>Active Checklists</CardTitle>
        </CardHeader>
        <CardContent>
        <Input
          placeholder="Search by name or employee code"
          value={checklistSearch}
          onChange={(e) => setChecklistSearch(e.target.value)}
          className="mb-3 max-w-xs"
        />
        <div className="flex flex-col gap-3">
          {filteredChecklists.map((c) => {
            const total = c.tasks.length
            const done = c.tasks.filter((t) => t.status === 'COMPLETED').length
            const percent = total === 0 ? 0 : Math.round((done / total) * 100)
            const missing = c.missingMandatoryFields
            return (
              <div key={c.id} className="rounded border p-3 text-sm">
                <div className="flex items-center justify-between">
                  <span className="font-medium">
                    {c.employee.firstName} {c.employee.lastName} ({c.employee.employeeCode})
                  </span>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">{percent}% complete</Badge>
                    <Badge variant="outline">{c.status}</Badge>
                  </div>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {missing.length === 0
                    ? 'All preboarding documents submitted.'
                    : `Documents missing: ${missing.map((f) => MANDATORY_FIELD_LABELS[f] ?? f).join(', ')}`}
                </p>
                <div className="mt-2 flex flex-col gap-3">
                  {groupByPhase(c.tasks).map(([phase, tasks]) => (
                    <div key={phase}>
                      <p className="mb-1 text-xs font-medium text-muted-foreground">
                        {ONBOARDING_PHASE_LABELS[phase]}
                      </p>
                      <ul className="flex flex-col gap-1">
                        {tasks.map((t) => (
                          <li key={t.id} className="flex items-center justify-between">
                            <span>
                              [{t.ownerRole}] {t.description}
                            </span>
                            {t.status === 'COMPLETED' ? (
                              <Badge>Done</Badge>
                            ) : t.ownerRole === 'NEW_HIRE' ? (
                              <span className="text-muted-foreground">Via preboarding portal</span>
                            ) : (
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={completingTaskId !== null}
                                onClick={() => handleCompleteTask(t.id)}
                              >
                                {completingTaskId === t.id ? 'Completing…' : 'Mark Complete'}
                              </Button>
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
                <div className="mt-2 flex items-center gap-2">
                  {missing.length === 0 ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={activatingId !== null}
                      onClick={() => handleActivate(c.employee.id)}
                    >
                      {activatingId === c.employee.id ? 'Activating…' : 'Activate (end Preboarding)'}
                    </Button>
                  ) : (
                    <span className="text-xs text-muted-foreground">
                      Can&apos;t activate until all documents are submitted.
                    </span>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={sendingLinkId !== null}
                    onClick={() => handleSendPortalLink(c.employee.id)}
                  >
                    {sendingLinkId === c.employee.id ? 'Sending…' : 'Resend Portal Link'}
                  </Button>
                </div>
              </div>
            )
          })}
          {filteredChecklists.length === 0 && (
            <p className="text-muted-foreground">
              {checklists.length === 0 ? 'No onboarding checklists in progress.' : 'No checklists match your search.'}
            </p>
          )}
        </div>
        </CardContent>
      </Card>
      )}

      {isHrAdmin && (
      <Card>
        <CardHeader>
          <CardTitle>Onboarding Checklist Templates</CardTitle>
        </CardHeader>
        <CardContent>
        <ul className="mb-4 flex flex-col gap-1 text-sm">
          {templates.map((t) => (
            <li key={t.id} className="flex items-center gap-2">
              <span>
                {t.name} {t.departmentId ? '' : '(all departments)'} — v{t.version} —{' '}
                {t.taskTemplates.length} tasks
              </span>
              {t.isDefault && <Badge variant="outline">Default</Badge>}
            </li>
          ))}
          {templates.length === 0 && (
            <p className="text-muted-foreground">No templates configured yet.</p>
          )}
        </ul>

        <div className="flex flex-col gap-2">
          <Label>Template name</Label>
          <Input value={templateName} onChange={(e) => setTemplateName(e.target.value)} />
          <Label>Department (optional — leave unset for a company-wide template)</Label>
          <Select value={templateDepartmentId} onValueChange={(v) => setTemplateDepartmentId(v ?? '')}>
            <SelectTrigger className="w-56">
              <SelectValue placeholder="Any department">
                {(v: string) => departments.find((d) => d.id === v)?.name ?? 'Any department'}
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

          {!templateDepartmentId && (
            <>
              <Label>
                Auto-selected default (used when starting onboarding without picking a template)
              </Label>
              <Select
                value={templateIsDefault ? 'YES' : 'NO'}
                onValueChange={(v) => setTemplateIsDefault(v === 'YES')}
              >
                <SelectTrigger className="w-56">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="NO">No — library option only</SelectItem>
                  <SelectItem value="YES">Yes — make this the default</SelectItem>
                </SelectContent>
              </Select>
            </>
          )}

          <div className="mt-2 flex flex-col gap-4">
            {ONBOARDING_PHASES.map((phase) => {
              const rowsInPhase = taskRows
                .map((row, i) => ({ row, i }))
                .filter(({ row }) => row.phase === phase)
              return (
                <div key={phase} className="rounded-md border p-2">
                  <p className="mb-2 text-xs font-medium text-muted-foreground">
                    {ONBOARDING_PHASE_LABELS[phase]}
                  </p>
                  <div className="flex flex-col gap-2">
                    {rowsInPhase.map(({ row, i }) => (
                      <div key={i} className="flex flex-wrap items-center gap-2">
                        <Select
                          value={row.ownerRole}
                          onValueChange={(v) => updateTaskRow(i, { ownerRole: v as ChecklistOwnerRole })}
                        >
                          <SelectTrigger className="w-32">
                            <SelectValue placeholder="Owner">{(v: string) => v}</SelectValue>
                          </SelectTrigger>
                          <SelectContent>
                            {OWNER_ROLES.map((r) => (
                              <SelectItem key={r} value={r}>
                                {r}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Input
                          placeholder="Task description"
                          className="flex-1"
                          value={row.description}
                          onChange={(e) => updateTaskRow(i, { description: e.target.value })}
                        />
                        <Input
                          type="number"
                          className="w-24"
                          placeholder="Due +days"
                          value={row.dueOffsetDays}
                          onChange={(e) => updateTaskRow(i, { dueOffsetDays: e.target.value })}
                        />
                        <Button size="sm" variant="outline" onClick={() => removeTaskRow(i)}>
                          Remove
                        </Button>
                      </div>
                    ))}
                    {rowsInPhase.length === 0 && (
                      <p className="text-xs text-muted-foreground">No tasks in this phase yet.</p>
                    )}
                    <Button size="sm" variant="outline" onClick={() => addTaskRow(phase)}>
                      Add Task to {ONBOARDING_PHASE_LABELS[phase]}
                    </Button>
                  </div>
                </div>
              )
            })}
          </div>

          <Button variant="outline" disabled={creatingTemplate || !canCreateTemplate} onClick={handleCreateTemplate}>
            {creatingTemplate ? 'Creating…' : 'Create Template'}
          </Button>
          {!canCreateTemplate && (
            <p className="text-xs text-muted-foreground">
              Give the template a name and fill in a description for every task before creating it.
            </p>
          )}
        </div>
        </CardContent>
      </Card>
      )}

      {isHrAdmin && (
      <Card>
        <CardHeader>
          <CardTitle>Probation Feedback</CardTitle>
        </CardHeader>
        <CardContent>
        <p className="mb-2 text-sm text-muted-foreground">
          30/60/90-day company and work-culture feedback submitted by employees still in probation.
        </p>
        <ul className="flex flex-col gap-2 text-sm">
          {feedback.map((f) => (
            <li key={f.id} className="rounded border p-2">
              <div className="flex items-center justify-between">
                <span className="font-medium">
                  {f.employee.firstName} {f.employee.lastName} ({f.employee.employeeCode})
                </span>
                <Badge variant="outline">{f.checkpoint.replace('_', ' ')}</Badge>
              </div>
              <p className="text-muted-foreground">
                Company: {f.companyRating}/5 · Work culture: {f.workCultureRating}/5
              </p>
              {f.comments && <p className="mt-1">{f.comments}</p>}
            </li>
          ))}
          {feedback.length === 0 && (
            <p className="text-muted-foreground">No feedback submitted yet.</p>
          )}
        </ul>
        </CardContent>
      </Card>
      )}
    </div>
  )
}
