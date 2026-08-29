import { useEffect, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
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
import {
  listDefinitions,
  createDefinition,
  myApprovals,
  decide,
  type ApproverRule,
  type ApproverRuleType,
  type StepCondition,
  type WorkflowStep,
  type WorkflowDefinition,
  type UnifiedApprovalItem,
} from '../api'

const APPROVER_TYPE_LABELS: Record<ApproverRuleType, string> = {
  MANAGER: "Employee's manager",
  SKIP_MANAGER: "Employee's manager's manager",
  ROLE: 'Anyone with a specific role',
}

// EMPLOYEE is deliberately left out — it isn't a sensible approver target,
// even though the backend's Role enum technically allows it.
const APPROVER_ROLE_OPTIONS = ['MANAGER', 'HR_ADMIN', 'SUPER_ADMIN']

// The backend's `module` field is deliberately free-text (see
// CreateWorkflowDefinitionDto — "so new modules can plug into the engine
// without a schema change"), but every module that actually exists today
// is tagged with one of these @RequiresModule() identifiers — a dropdown
// over the real set beats a free-text field an HR Admin could typo into
// silently matching nothing.
const MODULE_OPTIONS: Record<string, string> = {
  ANNOUNCEMENTS: 'Announcements',
  ANALYTICS: 'Analytics',
  ASSETS: 'Assets',
  ATS: 'Recruitment (ATS)',
  HELPDESK: 'Helpdesk',
  HOLIDAY: 'Holiday Calendar',
  LEARNING: 'Learning',
  OFFBOARDING: 'Offboarding',
  ONBOARDING: 'Onboarding',
  PERFORMANCE: 'Performance',
  SHIFT: 'Shift & Roster',
  WORKFLOW: 'Workflow',
}

const CONDITION_OPERATOR_LABELS: Record<StepCondition['operator'], string> = {
  gt: 'is greater than',
  gte: 'is greater than or equal to',
  lt: 'is less than',
  lte: 'is less than or equal to',
  eq: 'equals',
}

interface StepFormState {
  approverRules: ApproverRule[]
  requireAll: boolean
  slaHours: string
  escalationTargetRole: string
  conditionField: string
  conditionOperator: StepCondition['operator']
  conditionValue: string
}

function newStep(): StepFormState {
  return {
    approverRules: [{ type: 'MANAGER' }],
    requireAll: false,
    slaHours: '',
    escalationTargetRole: '',
    conditionField: '',
    conditionOperator: 'gt',
    conditionValue: '',
  }
}

export function WorkflowPage() {
  const { user } = useAuth()
  const isHrAdmin = user?.role === 'HR_ADMIN' || user?.role === 'SUPER_ADMIN'

  const [approvals, setApprovals] = useState<UnifiedApprovalItem[]>([])
  const [definitions, setDefinitions] = useState<WorkflowDefinition[]>([])
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const [name, setName] = useState('')
  const [moduleName, setModuleName] = useState('')
  const [steps, setSteps] = useState<StepFormState[]>([newStep()])

  useEffect(() => {
    refreshApprovals()
    if (isHrAdmin) refreshDefinitions()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function refreshApprovals() {
    myApprovals().then(setApprovals).catch(() => setApprovals([]))
  }

  function refreshDefinitions() {
    listDefinitions().then(setDefinitions).catch(() => setDefinitions([]))
  }

  async function handleDecide(requestId: string, decision: 'APPROVED' | 'REJECTED') {
    setError(null)
    try {
      await decide(requestId, { decision })
      setMessage(`Request ${decision.toLowerCase()}.`)
      refreshApprovals()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to record decision')
    }
  }

  function updateStep(index: number, patch: Partial<StepFormState>) {
    setSteps((prev) => prev.map((s, i) => (i === index ? { ...s, ...patch } : s)))
  }

  function addStep() {
    setSteps((prev) => [...prev, newStep()])
  }

  function removeStep(index: number) {
    setSteps((prev) => prev.filter((_, i) => i !== index))
  }

  function updateApproverRule(stepIndex: number, ruleIndex: number, patch: Partial<ApproverRule>) {
    setSteps((prev) =>
      prev.map((s, i) =>
        i === stepIndex
          ? {
              ...s,
              approverRules: s.approverRules.map((r, ri) => (ri === ruleIndex ? { ...r, ...patch } : r)),
            }
          : s,
      ),
    )
  }

  function addApproverRule(stepIndex: number) {
    setSteps((prev) =>
      prev.map((s, i) =>
        i === stepIndex ? { ...s, approverRules: [...s.approverRules, { type: 'MANAGER' }] } : s,
      ),
    )
  }

  function removeApproverRule(stepIndex: number, ruleIndex: number) {
    setSteps((prev) =>
      prev.map((s, i) =>
        i === stepIndex
          ? { ...s, approverRules: s.approverRules.filter((_, ri) => ri !== ruleIndex) }
          : s,
      ),
    )
  }

  async function handleCreateDefinition() {
    if (!name || !moduleName) return
    setError(null)
    setMessage(null)
    try {
      const payload: WorkflowStep[] = steps.map((s, i) => ({
        sequence: i,
        approverRules: s.approverRules,
        requireAll: s.requireAll,
        ...(s.slaHours ? { slaHours: Number(s.slaHours) } : {}),
        ...(s.escalationTargetRole ? { escalationTargetRole: s.escalationTargetRole } : {}),
        ...(s.conditionField
          ? {
              condition: {
                field: s.conditionField,
                operator: s.conditionOperator,
                value: Number(s.conditionValue),
              },
            }
          : {}),
      }))
      await createDefinition({ name, module: moduleName, steps: payload })
      setMessage('Workflow definition created.')
      setName('')
      setModuleName('')
      setSteps([newStep()])
      refreshDefinitions()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create workflow definition')
    }
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <h1 className="text-xl font-semibold">Workflow</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Your approval inbox, plus (for HR Admins) custom approval chains layered on top of a module's
          normal approver.
        </p>
      </div>

      {message && <p className="text-sm text-primary">{message}</p>}
      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="rounded-md border p-4 text-sm">
        <h2 className="mb-2 font-medium">My Approvals</h2>
        <p className="mb-2 text-muted-foreground">
          Everything waiting on your decision, in one list. Only items badged{' '}
          <Badge variant="outline" className="mx-1">WORKFLOW</Badge>
          are decided here — everything else is a summary link to that module's own page.
        </p>
        <ul className="flex flex-col gap-2">
          {approvals.map((a) => (
            <li key={`${a.source}-${a.id}`} className="flex items-center justify-between rounded border p-2">
              <div>
                <Badge variant="outline" className="mr-2">
                  {a.source}
                </Badge>
                {a.summary}
              </div>
              {a.source === 'WORKFLOW' && (
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => handleDecide(a.id, 'APPROVED')}>
                    Approve
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => handleDecide(a.id, 'REJECTED')}>
                    Reject
                  </Button>
                </div>
              )}
            </li>
          ))}
          {approvals.length === 0 && <p className="text-muted-foreground">No pending approvals.</p>}
        </ul>
      </div>

      {isHrAdmin && (
        <div className="rounded-md border p-4 text-sm">
          <h2 className="mb-2 font-medium">Workflow Definitions</h2>
          <p className="mb-3 text-muted-foreground">
            An extra approval chain attached to a module, on top of its normal approver — e.g. "over a
            certain amount, a second person must also sign off."
          </p>
          <ul className="mb-4 flex flex-col gap-1">
            {definitions.map((d) => (
              <li key={d.id}>
                {d.name} — {d.module} ({d.stepsJson.length} step{d.stepsJson.length === 1 ? '' : 's'})
              </li>
            ))}
            {definitions.length === 0 && <p className="text-muted-foreground">No workflow definitions yet.</p>}
          </ul>

          <div className="flex flex-col gap-4 rounded-md border bg-muted/20 p-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1">
                <Label>Name</Label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Offboarding clearance > 2 departments"
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label>Module</Label>
                <Select value={moduleName} onValueChange={setModuleName}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a module">
                      {(v: string) => MODULE_OPTIONS[v]}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(MODULE_OPTIONS).map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex flex-col gap-3">
              {steps.map((step, stepIndex) => (
                <div key={stepIndex} className="flex flex-col gap-3 rounded-md border bg-background p-3">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">Step {stepIndex + 1}</span>
                    {steps.length > 1 && (
                      <Button size="sm" variant="ghost" onClick={() => removeStep(stepIndex)}>
                        <Trash2 className="size-4" />
                      </Button>
                    )}
                  </div>

                  <div className="flex flex-col gap-2">
                    <Label className="text-xs text-muted-foreground">Who can approve this step</Label>
                    {step.approverRules.map((rule, ruleIndex) => (
                      <div key={ruleIndex} className="flex flex-wrap items-center gap-2">
                        <Select
                          value={rule.type}
                          onValueChange={(v) =>
                            updateApproverRule(stepIndex, ruleIndex, {
                              type: v as ApproverRuleType,
                              role: v === 'ROLE' ? (rule.role ?? 'MANAGER') : undefined,
                            })
                          }
                        >
                          <SelectTrigger className="w-56">
                            <SelectValue>{(v: string) => APPROVER_TYPE_LABELS[v as ApproverRuleType]}</SelectValue>
                          </SelectTrigger>
                          <SelectContent>
                            {(Object.keys(APPROVER_TYPE_LABELS) as ApproverRuleType[]).map((t) => (
                              <SelectItem key={t} value={t}>
                                {APPROVER_TYPE_LABELS[t]}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {rule.type === 'ROLE' && (
                          <Select
                            value={rule.role ?? 'MANAGER'}
                            onValueChange={(v) => updateApproverRule(stepIndex, ruleIndex, { role: v })}
                          >
                            <SelectTrigger className="w-40">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {APPROVER_ROLE_OPTIONS.map((r) => (
                                <SelectItem key={r} value={r}>
                                  {r.replaceAll('_', ' ')}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
                        {step.approverRules.length > 1 && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => removeApproverRule(stepIndex, ruleIndex)}
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        )}
                      </div>
                    ))}
                    <Button
                      size="sm"
                      variant="outline"
                      className="self-start"
                      onClick={() => addApproverRule(stepIndex)}
                    >
                      <Plus className="mr-1 size-3.5" /> Add another approver option
                    </Button>
                  </div>

                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={step.requireAll}
                      onChange={(e) => updateStep(stepIndex, { requireAll: e.target.checked })}
                    />
                    Require all approvers listed above (unchecked: any one is enough)
                  </label>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="flex flex-col gap-1">
                      <Label className="text-xs text-muted-foreground">
                        Escalate if not decided within (hours, optional)
                      </Label>
                      <Input
                        type="number"
                        min={1}
                        value={step.slaHours}
                        onChange={(e) => updateStep(stepIndex, { slaHours: e.target.value })}
                        placeholder="e.g. 48"
                      />
                    </div>
                    {step.slaHours && (
                      <div className="flex flex-col gap-1">
                        <Label className="text-xs text-muted-foreground">Notify this role on escalation</Label>
                        <Select
                          value={step.escalationTargetRole || 'NONE'}
                          onValueChange={(v) =>
                            updateStep(stepIndex, { escalationTargetRole: v === 'NONE' ? '' : v })
                          }
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="NONE">No one extra</SelectItem>
                            {APPROVER_ROLE_OPTIONS.map((r) => (
                              <SelectItem key={r} value={r}>
                                {r.replaceAll('_', ' ')}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                  </div>

                  <div className="flex flex-col gap-2">
                    <Label className="text-xs text-muted-foreground">
                      Only run this step when a condition is met (optional)
                    </Label>
                    <div className="flex flex-wrap items-center gap-2">
                      <Input
                        className="w-36"
                        placeholder="Field, e.g. amount"
                        value={step.conditionField}
                        onChange={(e) => updateStep(stepIndex, { conditionField: e.target.value })}
                      />
                      <Select
                        value={step.conditionOperator}
                        onValueChange={(v) => updateStep(stepIndex, { conditionOperator: v as StepCondition['operator'] })}
                      >
                        <SelectTrigger className="w-64">
                          <SelectValue>
                            {(v: string) => CONDITION_OPERATOR_LABELS[v as StepCondition['operator']]}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          {(Object.keys(CONDITION_OPERATOR_LABELS) as StepCondition['operator'][]).map((op) => (
                            <SelectItem key={op} value={op}>
                              {CONDITION_OPERATOR_LABELS[op]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Input
                        className="w-28"
                        type="number"
                        placeholder="Value"
                        value={step.conditionValue}
                        onChange={(e) => updateStep(stepIndex, { conditionValue: e.target.value })}
                      />
                    </div>
                  </div>
                </div>
              ))}
              <Button size="sm" variant="outline" className="self-start" onClick={addStep}>
                <Plus className="mr-1 size-3.5" /> Add another step
              </Button>
            </div>

            <Button size="sm" onClick={handleCreateDefinition} className="self-start">
              Create Definition
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
