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
  createTicket,
  listTickets,
  getTicket,
  addMessage,
  assignTicket,
  updateTicketStatus,
  searchFaq,
  createFaq,
  listSlaPolicies,
  upsertSlaPolicy,
  getDashboardSummary,
  type Ticket,
  type TicketDetail,
  type TicketCategory,
  type TicketPriority,
  type TicketStatus,
  type FaqEntry,
  type TicketSlaPolicy,
  type DashboardSummary,
} from '../api'

const CATEGORIES: TicketCategory[] = [
  'PAYROLL_QUERY',
  'LEAVE_ATTENDANCE_ISSUE',
  'IT_SUPPORT',
  'ADMIN_FACILITIES',
  'GENERAL_HR',
]
const PRIORITIES: TicketPriority[] = ['LOW', 'MEDIUM', 'HIGH', 'URGENT']
const STATUSES: TicketStatus[] = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED', 'REOPENED']

function label(value: string) {
  return value.replaceAll('_', ' ')
}

function priorityVariant(p: TicketPriority): 'destructive' | 'secondary' | 'outline' {
  if (p === 'URGENT' || p === 'HIGH') return 'destructive'
  if (p === 'MEDIUM') return 'secondary'
  return 'outline'
}

function statusVariant(s: TicketStatus): 'default' | 'secondary' | 'outline' | 'destructive' {
  if (s === 'RESOLVED' || s === 'CLOSED') return 'default'
  if (s === 'REOPENED') return 'destructive'
  if (s === 'IN_PROGRESS') return 'secondary'
  return 'outline'
}

export function HelpdeskPage() {
  const { user } = useAuth()
  const isHrAdmin = user?.role === 'HR_ADMIN' || user?.role === 'SUPER_ADMIN'

  const [people, setPeople] = useState<ManagerOption[]>([])
  const [tickets, setTickets] = useState<Ticket[]>([])
  const [selected, setSelected] = useState<TicketDetail | null>(null)
  const [faqResults, setFaqResults] = useState<FaqEntry[]>([])
  const [dashboard, setDashboard] = useState<DashboardSummary | null>(null)
  const [slaPolicies, setSlaPolicies] = useState<TicketSlaPolicy[]>([])

  const [faqQuery, setFaqQuery] = useState('')

  const [category, setCategory] = useState<TicketCategory | ''>('')
  const [priority, setPriority] = useState<TicketPriority>('MEDIUM')
  const [subject, setSubject] = useState('')
  const [description, setDescription] = useState('')

  const [statusFilter, setStatusFilter] = useState<TicketStatus | ''>('')

  const [replyBody, setReplyBody] = useState('')
  const [replyInternal, setReplyInternal] = useState(false)
  const [assignAgentId, setAssignAgentId] = useState('')
  const [resolutionNote, setResolutionNote] = useState('')
  const [csatRating, setCsatRating] = useState('')

  const [policyCategory, setPolicyCategory] = useState<TicketCategory | ''>('')
  const [policyPriority, setPolicyPriority] = useState<TicketPriority | ''>('')
  const [policyHours, setPolicyHours] = useState('')
  const [policyAgentId, setPolicyAgentId] = useState('')

  const [faqCategory, setFaqCategory] = useState<TicketCategory | ''>('')
  const [faqQuestion, setFaqQuestion] = useState('')
  const [faqAnswer, setFaqAnswer] = useState('')

  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getReferenceData().then((r) => setPeople(r.managers))
    refreshTickets()
    if (isHrAdmin) {
      refreshDashboard()
      refreshSlaPolicies()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function refreshTickets(status?: TicketStatus | '') {
    setLoading(true)
    listTickets({ status: status || undefined })
      .then((r) => setTickets(r.items))
      .catch(() => setTickets([]))
      .finally(() => setLoading(false))
  }

  function refreshDashboard() {
    getDashboardSummary().then(setDashboard).catch(() => setDashboard(null))
  }

  function refreshSlaPolicies() {
    listSlaPolicies().then(setSlaPolicies).catch(() => setSlaPolicies([]))
  }

  function personName(id: string) {
    const p = people.find((m) => m.id === id)
    return p ? `${p.firstName} ${p.lastName}` : id
  }

  async function openTicket(id: string) {
    setError(null)
    try {
      const detail = await getTicket(id)
      setSelected(detail)
      setResolutionNote(detail.resolutionNote ?? '')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load ticket')
    }
  }

  async function handleSearchFaq() {
    setError(null)
    try {
      const results = await searchFaq({ q: faqQuery || undefined })
      setFaqResults(results)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to search the knowledge base')
    }
  }

  async function handleCreateTicket() {
    if (!category) {
      setError('Please select a category')
      return
    }
    setError(null)
    setMessage(null)
    try {
      await createTicket({ category, priority, subject, description })
      setMessage('Ticket raised — you can track its status below.')
      setSubject('')
      setDescription('')
      refreshTickets(statusFilter)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to raise ticket')
    }
  }

  async function handleReply() {
    if (!selected || !replyBody) return
    setError(null)
    try {
      await addMessage(selected.id, { body: replyBody, isInternalNote: replyInternal })
      setReplyBody('')
      setReplyInternal(false)
      await openTicket(selected.id)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to send message')
    }
  }

  async function handleAssign() {
    if (!selected || !assignAgentId) return
    setError(null)
    try {
      await assignTicket(selected.id, assignAgentId)
      setMessage('Ticket assigned.')
      await openTicket(selected.id)
      refreshTickets(statusFilter)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to assign ticket')
    }
  }

  async function handleStatusChange(status: TicketStatus) {
    if (!selected) return
    setError(null)
    setMessage(null)
    try {
      await updateTicketStatus(selected.id, {
        status,
        resolutionNote: resolutionNote || undefined,
        csatRating: csatRating ? Number(csatRating) : undefined,
      })
      setMessage(`Ticket moved to ${label(status)}.`)
      await openTicket(selected.id)
      refreshTickets(statusFilter)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to update ticket status')
    }
  }

  async function handleUpsertPolicy() {
    if (!policyCategory || !policyPriority || !policyHours) return
    setError(null)
    setMessage(null)
    try {
      await upsertSlaPolicy({
        category: policyCategory,
        priority: policyPriority,
        slaHours: Number(policyHours),
        agentId: policyAgentId || undefined,
      })
      setMessage('SLA policy saved.')
      refreshSlaPolicies()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to save SLA policy')
    }
  }

  async function handleCreateFaq() {
    if (!faqQuestion || !faqAnswer) return
    setError(null)
    setMessage(null)
    try {
      await createFaq({ category: faqCategory || undefined, question: faqQuestion, answer: faqAnswer })
      setMessage('FAQ entry added.')
      setFaqQuestion('')
      setFaqAnswer('')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to add FAQ entry')
    }
  }

  const isOwner = selected && user && selected.employeeId === user.id
  const isAssignedAgent = selected && user && selected.assignedAgentId === user.id
  const canActAsAgent = isHrAdmin || isAssignedAgent

  return (
    <div className="flex flex-col gap-6 p-6">
      <h1 className="text-xl font-semibold">Helpdesk</h1>

      {message && <p className="text-sm text-primary">{message}</p>}
      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="flex flex-col gap-4">
          <div className="rounded-md border p-4">
            <h2 className="mb-2 font-medium">Search the Knowledge Base</h2>
            <div className="flex flex-wrap items-end gap-2">
              <Input
                placeholder="Search FAQs before raising a ticket"
                value={faqQuery}
                onChange={(e) => setFaqQuery(e.target.value)}
              />
              <Button size="sm" variant="outline" onClick={handleSearchFaq}>
                Search
              </Button>
            </div>
            <ul className="mt-3 flex flex-col gap-2 text-sm">
              {faqResults.map((f) => (
                <li key={f.id} className="rounded border p-2">
                  <p className="font-medium">{f.question}</p>
                  <p className="text-muted-foreground">{f.answer}</p>
                </li>
              ))}
              {faqResults.length === 0 && (
                <p className="text-muted-foreground">No results yet — try a search.</p>
              )}
            </ul>
          </div>

          <div className="rounded-md border p-4">
            <h2 className="mb-2 font-medium">Raise a Ticket</h2>
            <div className="flex flex-col gap-2">
              <Label>Category</Label>
              <Select value={category} onValueChange={(v) => setCategory(v as TicketCategory)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select category">{(v: string) => label(v)}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {label(c)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Label>Priority</Label>
              <Select value={priority} onValueChange={(v) => setPriority(v as TicketPriority)}>
                <SelectTrigger>
                  <SelectValue placeholder="Priority">{(v: string) => label(v)}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {PRIORITIES.map((p) => (
                    <SelectItem key={p} value={p}>
                      {label(p)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Label>Subject</Label>
              <Input value={subject} onChange={(e) => setSubject(e.target.value)} />
              <Label>Description</Label>
              <Textarea value={description} onChange={(e) => setDescription(e.target.value)} />
              <Button variant="outline" onClick={handleCreateTicket}>
                Raise Ticket
              </Button>
            </div>
          </div>

          <div className="rounded-md border p-4">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="font-medium">{isHrAdmin ? 'All Tickets' : 'My Tickets'}</h2>
              <Select
                value={statusFilter}
                onValueChange={(v) => {
                  const next = v as TicketStatus | ''
                  setStatusFilter(next)
                  refreshTickets(next)
                }}
              >
                <SelectTrigger className="w-40">
                  <SelectValue placeholder="Any status">{(v: string) => (v ? label(v) : 'Any status')}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Any status</SelectItem>
                  {STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {label(s)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {loading && <p className="text-sm text-muted-foreground">Loading tickets…</p>}

            <ul className="flex flex-col gap-2 text-sm">
              {tickets.map((t) => (
                <li key={t.id}>
                  <button
                    className="flex w-full items-center justify-between rounded border p-2 text-left hover:bg-muted"
                    onClick={() => openTicket(t.id)}
                  >
                    <div>
                      <p className="font-medium">{t.subject}</p>
                      <p className="text-muted-foreground">{label(t.category)}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      {t.slaBreachedAt && <Badge variant="destructive">SLA breached</Badge>}
                      <Badge variant={priorityVariant(t.priority)}>{label(t.priority)}</Badge>
                      <Badge variant={statusVariant(t.status)}>{label(t.status)}</Badge>
                    </div>
                  </button>
                </li>
              ))}
              {!loading && tickets.length === 0 && (
                <p className="text-muted-foreground">No tickets yet.</p>
              )}
            </ul>
          </div>
        </div>

        <div className="flex flex-col gap-4">
          {!selected && <p className="text-muted-foreground">Select a ticket to see its details.</p>}

          {selected && (
            <div className="rounded-md border p-4 text-sm">
              <div className="flex items-center justify-between">
                <h2 className="font-medium">{selected.subject}</h2>
                <div className="flex items-center gap-2">
                  <Badge variant={priorityVariant(selected.priority)}>{label(selected.priority)}</Badge>
                  <Badge variant={statusVariant(selected.status)}>{label(selected.status)}</Badge>
                </div>
              </div>
              <p className="mt-1 text-muted-foreground">{label(selected.category)}</p>
              <p className="mt-2">{selected.description}</p>
              {selected.slaDueAt && (
                <p className="mt-2 text-muted-foreground">
                  SLA due: {new Date(selected.slaDueAt).toLocaleString()}
                  {selected.slaBreachedAt && <span className="text-destructive"> — breached</span>}
                </p>
              )}
              {selected.assignedAgentId && (
                <p className="text-muted-foreground">Assigned to: {personName(selected.assignedAgentId)}</p>
              )}

              <div className="mt-3 flex flex-col gap-2 border-t pt-3">
                <h3 className="font-medium">Conversation</h3>
                {selected.messages.map((m) => (
                  <div key={m.id} className={`rounded border p-2 ${m.isInternalNote ? 'bg-muted' : ''}`}>
                    <p className="text-xs text-muted-foreground">
                      {personName(m.senderId)} {m.isInternalNote && '(internal note)'} —{' '}
                      {new Date(m.createdAt).toLocaleString()}
                    </p>
                    <p>{m.body}</p>
                  </div>
                ))}
                {selected.messages.length === 0 && (
                  <p className="text-muted-foreground">No messages yet.</p>
                )}

                <Textarea
                  placeholder="Write a reply"
                  value={replyBody}
                  onChange={(e) => setReplyBody(e.target.value)}
                />
                {canActAsAgent && (
                  <label className="flex items-center gap-2 text-xs text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={replyInternal}
                      onChange={(e) => setReplyInternal(e.target.checked)}
                    />
                    Internal note (not visible to employee)
                  </label>
                )}
                <Button size="sm" variant="outline" onClick={handleReply}>
                  Send
                </Button>
              </div>

              {isHrAdmin && selected.status !== 'RESOLVED' && selected.status !== 'CLOSED' && (
                <div className="mt-3 flex flex-wrap items-end gap-2 border-t pt-3">
                  <Select value={assignAgentId} onValueChange={setAssignAgentId}>
                    <SelectTrigger className="w-56">
                      <SelectValue placeholder="Assign to agent">{(v: string) => personName(v)}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {people.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.firstName} {p.lastName}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button size="sm" variant="outline" onClick={handleAssign}>
                    Assign
                  </Button>
                </div>
              )}

              <div className="mt-3 flex flex-col gap-2 border-t pt-3">
                <h3 className="font-medium">Actions</h3>
                {selected.status === 'OPEN' && canActAsAgent && (
                  <Button size="sm" variant="outline" onClick={() => handleStatusChange('IN_PROGRESS')}>
                    Pick Up
                  </Button>
                )}
                {selected.status === 'REOPENED' && canActAsAgent && (
                  <Button size="sm" variant="outline" onClick={() => handleStatusChange('IN_PROGRESS')}>
                    Pick Up
                  </Button>
                )}
                {selected.status === 'IN_PROGRESS' && canActAsAgent && (
                  <div className="flex flex-col gap-2">
                    <Textarea
                      placeholder="Resolution note"
                      value={resolutionNote}
                      onChange={(e) => setResolutionNote(e.target.value)}
                    />
                    <Button size="sm" variant="outline" onClick={() => handleStatusChange('RESOLVED')}>
                      Mark Resolved
                    </Button>
                  </div>
                )}
                {selected.status === 'RESOLVED' && (isOwner || canActAsAgent) && (
                  <div className="flex flex-col gap-2">
                    <Textarea
                      placeholder="Resolution note (required to close)"
                      value={resolutionNote}
                      onChange={(e) => setResolutionNote(e.target.value)}
                    />
                    {isOwner && (
                      <Input
                        type="number"
                        min={1}
                        max={5}
                        placeholder="Rate this resolution 1-5 (CSAT)"
                        value={csatRating}
                        onChange={(e) => setCsatRating(e.target.value)}
                      />
                    )}
                    <Button size="sm" variant="outline" onClick={() => handleStatusChange('CLOSED')}>
                      Close Ticket
                    </Button>
                  </div>
                )}
                {selected.status === 'CLOSED' && isOwner && (
                  <Button size="sm" variant="outline" onClick={() => handleStatusChange('REOPENED')}>
                    Reopen Ticket
                  </Button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {isHrAdmin && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="rounded-md border p-4 text-sm">
            <h2 className="mb-2 font-medium">Dashboard</h2>
            {dashboard ? (
              <div className="flex flex-col gap-1">
                <p>SLA compliance: {dashboard.slaCompliancePercent}%</p>
                <p>
                  Top categories:{' '}
                  {dashboard.topCategories.map((c) => `${label(c.category)} (${c.count})`).join(', ') || '—'}
                </p>
                <p>
                  Volume by category:{' '}
                  {Object.entries(dashboard.volumeByCategory)
                    .map(([c, n]) => `${label(c)}: ${n}`)
                    .join(', ') || '—'}
                </p>
              </div>
            ) : (
              <p className="text-muted-foreground">No data yet.</p>
            )}
          </div>

          <div className="rounded-md border p-4 text-sm">
            <h2 className="mb-2 font-medium">SLA Policies</h2>
            <ul className="mb-3 flex flex-col gap-1">
              {slaPolicies.map((p) => (
                <li key={p.id}>
                  {label(p.category)} / {label(p.priority)}: {p.slaHours}h
                  {p.agentId && ` — agent: ${personName(p.agentId)}`}
                </li>
              ))}
              {slaPolicies.length === 0 && (
                <p className="text-muted-foreground">Using built-in default SLAs.</p>
              )}
            </ul>
            <div className="flex flex-wrap items-end gap-2">
              <Select value={policyCategory} onValueChange={(v) => setPolicyCategory(v as TicketCategory)}>
                <SelectTrigger className="w-40">
                  <SelectValue placeholder="Category">{(v: string) => label(v)}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {label(c)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={policyPriority} onValueChange={(v) => setPolicyPriority(v as TicketPriority)}>
                <SelectTrigger className="w-32">
                  <SelectValue placeholder="Priority">{(v: string) => label(v)}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {PRIORITIES.map((p) => (
                    <SelectItem key={p} value={p}>
                      {label(p)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                type="number"
                placeholder="SLA hours"
                className="w-28"
                value={policyHours}
                onChange={(e) => setPolicyHours(e.target.value)}
              />
              <Select value={policyAgentId} onValueChange={setPolicyAgentId}>
                <SelectTrigger className="w-48">
                  <SelectValue placeholder="Designated agent">
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
              <Button size="sm" variant="outline" onClick={handleUpsertPolicy}>
                Save Policy
              </Button>
            </div>
          </div>

          <div className="rounded-md border p-4 text-sm lg:col-span-2">
            <h2 className="mb-2 font-medium">Add FAQ Entry</h2>
            <div className="flex flex-col gap-2">
              <Select value={faqCategory} onValueChange={(v) => setFaqCategory(v as TicketCategory)}>
                <SelectTrigger className="w-56">
                  <SelectValue placeholder="Category (optional)">{(v: string) => label(v)}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {label(c)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input placeholder="Question" value={faqQuestion} onChange={(e) => setFaqQuestion(e.target.value)} />
              <Textarea placeholder="Answer" value={faqAnswer} onChange={(e) => setFaqAnswer(e.target.value)} />
              <Button size="sm" variant="outline" onClick={handleCreateFaq}>
                Add FAQ Entry
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
