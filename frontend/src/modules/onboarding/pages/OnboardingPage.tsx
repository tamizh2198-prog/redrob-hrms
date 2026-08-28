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
  type ChecklistWithEmployee,
  type OnboardingTemplate,
  type ChecklistOwnerRole,
} from '../api'

const OWNER_ROLES: ChecklistOwnerRole[] = ['HR', 'IT', 'MANAGER', 'NEW_HIRE']

interface TaskRow {
  ownerRole: ChecklistOwnerRole
  description: string
  dueOffsetDays: string
}

export function OnboardingPage() {
  const { user } = useAuth()
  const isHrAdmin = canAccessHrOperationalModules(user?.role)

  const [checklists, setChecklists] = useState<ChecklistWithEmployee[]>([])
  const [templates, setTemplates] = useState<OnboardingTemplate[]>([])
  const [departments, setDepartments] = useState<ReferenceOption[]>([])
  const [people, setPeople] = useState<ManagerOption[]>([])

  const [templateName, setTemplateName] = useState('')
  const [templateDepartmentId, setTemplateDepartmentId] = useState('')
  const [taskRows, setTaskRows] = useState<TaskRow[]>([
    { ownerRole: 'NEW_HIRE', description: '', dueOffsetDays: '0' },
  ])

  const [initEmployeeId, setInitEmployeeId] = useState('')

  const preboardingPeople = people.filter((p) => p.status === 'PREBOARDING')

  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

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
    }
  }

  function addTaskRow() {
    setTaskRows((rows) => [...rows, { ownerRole: 'HR', description: '', dueOffsetDays: '0' }])
  }

  function removeTaskRow(index: number) {
    setTaskRows((rows) => rows.filter((_, i) => i !== index))
  }

  function updateTaskRow(index: number, patch: Partial<TaskRow>) {
    setTaskRows((rows) => rows.map((r, i) => (i === index ? { ...r, ...patch } : r)))
  }

  async function handleCreateTemplate() {
    setError(null)
    setMessage(null)
    try {
      await createTemplate({
        name: templateName,
        departmentId: templateDepartmentId || undefined,
        tasks: taskRows.map((t) => ({
          ownerRole: t.ownerRole,
          description: t.description,
          dueOffsetDays: Number(t.dueOffsetDays) || 0,
        })),
      })
      setMessage('Onboarding template created.')
      setTemplateName('')
      setTaskRows([{ ownerRole: 'NEW_HIRE', description: '', dueOffsetDays: '0' }])
      refresh()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create template')
    }
  }

  async function handleInitChecklist() {
    setError(null)
    setMessage(null)
    try {
      await initChecklist(initEmployeeId)
      setMessage('Onboarding checklist created.')
      refresh()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create checklist')
    }
  }

  async function handleCompleteTask(taskId: string) {
    setError(null)
    try {
      await completeTask(taskId)
      refresh()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to complete task')
    }
  }

  async function handleActivate(employeeId: string) {
    setError(null)
    setMessage(null)
    try {
      await activateEmployee(employeeId)
      setMessage('Employee activated.')
      refresh()
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : 'Failed to activate employee',
      )
    }
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <h1 className="text-xl font-semibold">Onboarding</h1>

      {message && <p className="text-sm text-primary">{message}</p>}
      {error && <p className="text-sm text-destructive">{error}</p>}

      {!isHrAdmin && (
        <p className="text-sm text-muted-foreground">
          Onboarding administration (starting checklists, managing templates) is available to HR
          Admins. You can still see progress on checklists you own tasks in.
        </p>
      )}

      {isHrAdmin && (
        <div className="rounded-md border p-4">
          <h2 className="mb-2 font-medium">Start Onboarding for a New Hire</h2>
          <p className="mb-2 text-sm text-muted-foreground">
            Only employees currently in Preboarding status (post-offer-accept, pre-Day-1) can have
            a checklist started — anyone else can never pass the later Activate step.
          </p>
          <div className="flex flex-wrap items-end gap-2">
            <Select value={initEmployeeId} onValueChange={setInitEmployeeId}>
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
            <Button variant="outline" onClick={handleInitChecklist} disabled={!initEmployeeId}>
              Create Checklist
            </Button>
          </div>
          {preboardingPeople.length === 0 && (
            <p className="mt-2 text-sm text-muted-foreground">
              No employees are currently in Preboarding status.
            </p>
          )}
        </div>
      )}

      {isHrAdmin && (
      <div className="rounded-md border p-4">
        <h2 className="mb-2 font-medium">Active Checklists</h2>
        <div className="flex flex-col gap-3">
          {checklists.map((c) => {
            const total = c.tasks.length
            const done = c.tasks.filter((t) => t.status === 'COMPLETED').length
            const percent = total === 0 ? 0 : Math.round((done / total) * 100)
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
                <ul className="mt-2 flex flex-col gap-1">
                  {c.tasks.map((t) => (
                    <li key={t.id} className="flex items-center justify-between">
                      <span>
                        [{t.ownerRole}] {t.description}
                      </span>
                      {t.status === 'COMPLETED' ? (
                        <Badge>Done</Badge>
                      ) : t.ownerRole === 'NEW_HIRE' ? (
                        <span className="text-muted-foreground">Via preboarding portal</span>
                      ) : (
                        <Button size="sm" variant="outline" onClick={() => handleCompleteTask(t.id)}>
                          Mark Complete
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
                <div className="mt-2">
                  <Button size="sm" variant="outline" onClick={() => handleActivate(c.employee.id)}>
                    Activate (end Preboarding)
                  </Button>
                </div>
              </div>
            )
          })}
          {checklists.length === 0 && (
            <p className="text-muted-foreground">No onboarding checklists in progress.</p>
          )}
        </div>
      </div>
      )}

      {isHrAdmin && (
      <div className="rounded-md border p-4">
        <h2 className="mb-2 font-medium">Onboarding Checklist Templates</h2>
        <ul className="mb-4 flex flex-col gap-1 text-sm">
          {templates.map((t) => (
            <li key={t.id}>
              {t.name} {t.departmentId ? '' : '(all departments)'} — v{t.version} —{' '}
              {t.taskTemplates.length} tasks
            </li>
          ))}
          {templates.length === 0 && (
            <p className="text-muted-foreground">No templates configured yet.</p>
          )}
        </ul>

        <div className="flex flex-col gap-2">
          <Label>Template name</Label>
          <Input value={templateName} onChange={(e) => setTemplateName(e.target.value)} />
          <Label>Department (optional — leave unset for a company-wide default)</Label>
          <Select value={templateDepartmentId} onValueChange={setTemplateDepartmentId}>
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

          <div className="mt-2 flex flex-col gap-2">
            {taskRows.map((row, i) => (
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
            <Button size="sm" variant="outline" onClick={addTaskRow}>
              Add Task
            </Button>
          </div>

          <Button variant="outline" onClick={handleCreateTemplate}>
            Create Template
          </Button>
        </div>
      </div>
      )}
    </div>
  )
}
