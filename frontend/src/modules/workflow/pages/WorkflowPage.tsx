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
      <h1 className="text-xl font-semibold">Workflow</h1>

      {message && <p className="text-sm text-primary">{message}</p>}
      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="rounded-md border p-4 text-sm">
        <h2 className="mb-2 font-medium">My Approvals</h2>
        <p className="mb-2 text-muted-foreground">
          A single inbox aggregating pending approvals across Leave, Attendance, Assets, Recruitment and
          any custom workflow.
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
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Leave Approval > 5 days" />
            <Label>Module</Label>
            <Input value={moduleName} onChange={(e) => setModuleName(e.target.value)} placeholder="LEAVE" />
            <Label>Steps (JSON)</Label>
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
