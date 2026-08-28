import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { useAuth } from '@/shared/auth/AuthContext'
import { ApiError } from '@/lib/api'
import {
  listDefinitions,
  createDefinition,
  myApprovals,
  decide,
  type WorkflowDefinition,
  type UnifiedApprovalItem,
} from '../api'

const EXAMPLE_STEPS = JSON.stringify(
  [
    { sequence: 0, approverRules: [{ type: 'MANAGER' }], requireAll: false, slaHours: 48 },
    {
      sequence: 1,
      approverRules: [{ type: 'ROLE', role: 'HR_ADMIN' }],
      requireAll: false,
      condition: { field: 'daysCount', operator: 'gt', value: 10 },
    },
  ],
  null,
  2,
)

export function WorkflowPage() {
  const { user } = useAuth()
  const isHrAdmin = user?.role === 'HR_ADMIN' || user?.role === 'SUPER_ADMIN'

  const [approvals, setApprovals] = useState<UnifiedApprovalItem[]>([])
  const [definitions, setDefinitions] = useState<WorkflowDefinition[]>([])
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const [name, setName] = useState('')
  const [moduleName, setModuleName] = useState('')
  const [stepsText, setStepsText] = useState(EXAMPLE_STEPS)

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

  async function handleCreateDefinition() {
    if (!name || !moduleName) return
    setError(null)
    setMessage(null)
    try {
      const steps = JSON.parse(stepsText)
      await createDefinition({ name, module: moduleName, steps })
      setMessage('Workflow definition created.')
      setName('')
      setModuleName('')
      refreshDefinitions()
    } catch (err) {
      if (err instanceof ApiError) setError(err.message)
      else if (err instanceof SyntaxError) setError('Steps must be valid JSON')
      else setError('Failed to create workflow definition')
    }
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <h1 className="text-xl font-semibold">Workflow</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Workflow isn&apos;t a separate approval system — it&apos;s two things: your unified approval
          inbox below (everything waiting on your sign-off, from any module), and, for HR Admins, a
          way to define extra custom approval chains (e.g. "offboarding clearance across more than
          2 departments needs HR Admin too") on top of each module&apos;s normal approver.
        </p>
      </div>

      {message && <p className="text-sm text-primary">{message}</p>}
      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="rounded-md border p-4 text-sm">
        <h2 className="mb-2 font-medium">My Approvals</h2>
        <p className="mb-2 text-muted-foreground">
          Everything currently waiting on your decision, in one list — custom workflow steps, asset
          requests, and (for HR Admin/Super Admin) recruitment requisitions and offers — instead of
          checking each module separately. The badge on the left tells you which module it came from;
          only items badged{' '}
          <Badge variant="outline" className="mx-1">WORKFLOW</Badge>
          are decided here — everything else (e.g. <Badge variant="outline" className="mx-1">ASSETS</Badge>)
          is just a summary, so go to that module's own page to act on it.
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
            A definition is an extra approval chain your company can attach to a module (e.g. OFFBOARDING,
            PERFORMANCE) on top of that module's normal single approver — useful for rules like "over a
            certain amount, a second person must also sign off." Each definition has one or more
            ordered <strong>steps</strong>; a request moves to the next step only after the current one
            is satisfied.
          </p>
          <ul className="mb-3 flex flex-col gap-1">
            {definitions.map((d) => (
              <li key={d.id}>
                {d.name} — {d.module} ({d.stepsJson.length} step(s))
              </li>
            ))}
            {definitions.length === 0 && <p className="text-muted-foreground">No workflow definitions yet.</p>}
          </ul>

          <div className="flex flex-col gap-2">
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Offboarding clearance > 2 departments" />
            <p className="text-xs text-muted-foreground">A short label for your own reference — not shown to employees.</p>

            <Label>Module</Label>
            <Input value={moduleName} onChange={(e) => setModuleName(e.target.value)} placeholder="OFFBOARDING" />
            <p className="text-xs text-muted-foreground">
              Which module this chain applies to — must match a module name exactly, e.g. OFFBOARDING,
              PERFORMANCE.
            </p>

            <Label>Steps (JSON)</Label>
            <div className="rounded border bg-muted/30 p-3 text-xs text-muted-foreground">
              <p className="mb-1 font-medium text-foreground">What each field means:</p>
              <ul className="list-disc space-y-1 pl-4">
                <li><code>sequence</code> — step order, starting at 0 (0 runs first, then 1, and so on).</li>
                <li>
                  <code>approverRules</code> — who can approve this step: <code>{'{ type: "MANAGER" }'}</code>{' '}
                  for the employee's own manager, or <code>{'{ type: "ROLE", role: "HR_ADMIN" }'}</code> for
                  anyone with that role. List more than one rule to allow any of several approvers.
                </li>
                <li><code>requireAll</code> — <code>true</code> if every listed approver must approve; <code>false</code> if any one is enough.</li>
                <li><code>slaHours</code> — optional: hours before this step is flagged overdue/escalated.</li>
                <li>
                  <code>condition</code> — optional: only run this step when a field on the request matches,
                  e.g. <code>{'{ field: "daysCount", operator: "gt", value: 10 }'}</code> (only when that
                  field on the request context exceeds 10). Omit to always run the step.
                </li>
              </ul>
            </div>
            <Textarea rows={10} value={stepsText} onChange={(e) => setStepsText(e.target.value)} />
            <Button size="sm" variant="outline" onClick={handleCreateDefinition}>
              Create Definition
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
