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
import { getReferenceData, type ManagerOption, type ReferenceOption } from '@/modules/employee/api'
import {
  createAnnouncement,
  listAnnouncements,
  ackAnnouncement,
  getAnnouncementCompliance,
  getAnnouncementComplianceUsers,
  createRecognition,
  listRecognitionFeed,
  type Announcement,
  type AnnouncementScope,
  type AnnouncementPriority,
  type AnnouncementCompliance,
  type AnnouncementComplianceUser,
  type Recognition,
  type RecognitionCategory,
} from '../api'

const SCOPES: AnnouncementScope[] = ['ORGANIZATION', 'DEPARTMENT', 'LOCATION']
const PRIORITIES: AnnouncementPriority[] = ['LOW', 'MEDIUM', 'HIGH']
const CATEGORIES: RecognitionCategory[] = ['TEAMWORK', 'INNOVATION', 'CUSTOMER_FOCUS']

function label(value: string) {
  return value.replaceAll('_', ' ')
}

function priorityVariant(p: AnnouncementPriority): 'destructive' | 'secondary' | 'outline' {
  if (p === 'HIGH') return 'destructive'
  if (p === 'MEDIUM') return 'secondary'
  return 'outline'
}

export function AnnouncementsPage() {
  const { user } = useAuth()
  const isHrAdmin = user?.role === 'HR_ADMIN' || user?.role === 'SUPER_ADMIN'
  const canCreateAnnouncement = isHrAdmin || user?.role === 'MANAGER'

  const [departments, setDepartments] = useState<ReferenceOption[]>([])
  const [locations, setLocations] = useState<ReferenceOption[]>([])
  const [people, setPeople] = useState<ManagerOption[]>([])
  const [announcements, setAnnouncements] = useState<Announcement[]>([])
  const [recognitions, setRecognitions] = useState<Recognition[]>([])

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [compliance, setCompliance] = useState<AnnouncementCompliance | null>(null)
  const [complianceUsers, setComplianceUsers] = useState<AnnouncementComplianceUser[]>([])

  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [scope, setScope] = useState<AnnouncementScope>('ORGANIZATION')
  const [departmentId, setDepartmentId] = useState('')
  const [locationId, setLocationId] = useState('')
  const [priority, setPriority] = useState<AnnouncementPriority>('MEDIUM')
  const [isPinned, setIsPinned] = useState(false)
  const [requiresAck, setRequiresAck] = useState(false)

  const [recipientId, setRecipientId] = useState('')
  const [recMessage, setRecMessage] = useState('')
  const [recCategory, setRecCategory] = useState<RecognitionCategory>('TEAMWORK')
  const [recDepartmentId, setRecDepartmentId] = useState('')

  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getReferenceData().then((r) => {
      setDepartments(r.departments)
      setLocations(r.locations)
      setPeople(r.managers)
    })
    refreshAnnouncements()
    refreshRecognitions()
     
  }, [])

  function refreshAnnouncements() {
    setLoading(true)
    listAnnouncements()
      .then(setAnnouncements)
      .catch(() => setAnnouncements([]))
      .finally(() => setLoading(false))
  }

  function refreshRecognitions() {
    listRecognitionFeed().then(setRecognitions).catch(() => setRecognitions([]))
  }

  function personName(id: string) {
    const p = people.find((m) => m.id === id)
    return p ? `${p.firstName} ${p.lastName}` : id
  }

  function departmentName(id: string | null) {
    if (!id) return null
    return departments.find((d) => d.id === id)?.name ?? id
  }

  async function openCompliance(id: string) {
    setError(null)
    setSelectedId(id)
    try {
      const [summary, users] = await Promise.all([
        getAnnouncementCompliance(id),
        getAnnouncementComplianceUsers(id),
      ])
      setCompliance(summary)
      setComplianceUsers(users)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load compliance')
    }
  }

  async function handleCreateAnnouncement() {
    setError(null)
    setMessage(null)
    try {
      await createAnnouncement({
        title,
        body,
        scope,
        departmentId: scope === 'DEPARTMENT' ? departmentId : undefined,
        locationId: scope === 'LOCATION' ? locationId : undefined,
        priority,
        isPinned,
        requiresAck,
      })
      setMessage('Announcement published.')
      setTitle('')
      setBody('')
      setIsPinned(false)
      setRequiresAck(false)
      refreshAnnouncements()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to publish announcement')
    }
  }

  async function handleAck(id: string) {
    setError(null)
    try {
      await ackAnnouncement(id)
      refreshAnnouncements()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to acknowledge announcement')
    }
  }

  async function handleSendRecognition() {
    if (!recipientId || !recMessage) return
    setError(null)
    setMessage(null)
    try {
      await createRecognition({
        recipientId,
        message: recMessage,
        category: recCategory,
        departmentId: recDepartmentId || undefined,
      })
      setMessage('Recognition sent.')
      setRecMessage('')
      refreshRecognitions()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to send recognition')
    }
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <h1 className="text-xl font-semibold">Announcements & Recognition</h1>

      {message && <p className="text-sm text-primary">{message}</p>}
      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="flex flex-col gap-4">
          {canCreateAnnouncement && (
            <div className="rounded-md border p-4">
              <h2 className="mb-2 font-medium">Publish an Announcement</h2>
              <div className="flex flex-col gap-2">
                <Label>Title</Label>
                <Input value={title} onChange={(e) => setTitle(e.target.value)} />
                <Label>Body</Label>
                <Textarea value={body} onChange={(e) => setBody(e.target.value)} />
                <Label>Target scope</Label>
                <Select value={scope} onValueChange={(v) => setScope(v as AnnouncementScope)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Scope">{(v: string) => label(v)}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {SCOPES.map((s) => (
                      <SelectItem key={s} value={s}>
                        {label(s)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {scope === 'DEPARTMENT' && (
                  <>
                    <Label>Department</Label>
                    <Select value={departmentId} onValueChange={setDepartmentId}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select department">
                          {(v: string) => departments.find((d) => d.id === v)?.name ?? 'Select'}
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
                  </>
                )}
                {scope === 'LOCATION' && (
                  <>
                    <Label>Location</Label>
                    <Select value={locationId} onValueChange={setLocationId}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select location">
                          {(v: string) => locations.find((l) => l.id === v)?.name ?? 'Select'}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {locations.map((l) => (
                          <SelectItem key={l.id} value={l.id}>
                            {l.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </>
                )}
                <Label>Priority</Label>
                <Select value={priority} onValueChange={(v) => setPriority(v as AnnouncementPriority)}>
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
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={isPinned} onChange={(e) => setIsPinned(e.target.checked)} />
                  Pin to top
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={requiresAck}
                    onChange={(e) => setRequiresAck(e.target.checked)}
                  />
                  Requires acknowledgement
                </label>
                <Button variant="outline" onClick={handleCreateAnnouncement}>
                  Publish
                </Button>
              </div>
            </div>
          )}

          <div className="rounded-md border p-4">
            <h2 className="mb-2 font-medium">Announcements</h2>
            {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
            <ul className="flex flex-col gap-2 text-sm">
              {announcements.map((a) => (
                <li key={a.id} className="rounded border p-3">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">
                      {a.isPinned && '📌 '}
                      {a.title}
                    </span>
                    <div className="flex items-center gap-2">
                      <Badge variant={priorityVariant(a.priority)}>{label(a.priority)}</Badge>
                      <Badge variant="outline">{label(a.scope)}</Badge>
                    </div>
                  </div>
                  <p className="mt-1 text-muted-foreground">{a.body}</p>
                  <div className="mt-2 flex items-center gap-2">
                    {a.requiresAck &&
                      (a.myAck?.acknowledgedAt ? (
                        <Badge>Acknowledged</Badge>
                      ) : (
                        <Button size="sm" variant="outline" onClick={() => handleAck(a.id)}>
                          Acknowledge
                        </Button>
                      ))}
                    {isHrAdmin && a.requiresAck && (
                      <Button size="sm" variant="outline" onClick={() => openCompliance(a.id)}>
                        View Compliance
                      </Button>
                    )}
                  </div>
                </li>
              ))}
              {!loading && announcements.length === 0 && (
                <p className="text-muted-foreground">No announcements visible to you yet.</p>
              )}
            </ul>
          </div>

          {isHrAdmin && selectedId && compliance && (
            <div className="rounded-md border p-4 text-sm">
              <h2 className="mb-2 font-medium">Compliance</h2>
              <p>Total targeted: {compliance.totalTargeted}</p>
              <p>Acknowledged: {compliance.acknowledged}</p>
              <p>Pending: {compliance.pending}</p>
              <p>Compliance: {compliance.compliancePercentage}%</p>
              <ul className="mt-2 flex flex-col gap-1">
                {complianceUsers.map((u) => (
                  <li key={u.employeeId} className="flex items-center justify-between">
                    <span>
                      {u.firstName} {u.lastName} ({u.employeeCode})
                    </span>
                    <Badge variant={u.acknowledged ? 'default' : 'outline'}>
                      {u.acknowledged ? 'Acknowledged' : 'Pending'}
                    </Badge>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-4">
          <div className="rounded-md border p-4">
            <h2 className="mb-2 font-medium">Send Recognition</h2>
            <div className="flex flex-col gap-2">
              <Label>Recipient</Label>
              <Select value={recipientId} onValueChange={setRecipientId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select colleague">{(v: string) => personName(v)}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {people.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.firstName} {p.lastName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Label>Category</Label>
              <Select value={recCategory} onValueChange={(v) => setRecCategory(v as RecognitionCategory)}>
                <SelectTrigger>
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
              <Label>Message</Label>
              <Textarea value={recMessage} onChange={(e) => setRecMessage(e.target.value)} />
              <Label>Restrict visibility to a department (optional)</Label>
              <Select value={recDepartmentId} onValueChange={setRecDepartmentId}>
                <SelectTrigger>
                  <SelectValue placeholder="Public (visible to everyone)">
                    {(v: string) => departments.find((d) => d.id === v)?.name ?? 'Public'}
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
              <Button variant="outline" onClick={handleSendRecognition}>
                Send Recognition
              </Button>
            </div>
          </div>

          <div className="rounded-md border p-4">
            <h2 className="mb-2 font-medium">Recognition Feed</h2>
            <ul className="flex flex-col gap-2 text-sm">
              {recognitions.map((r) => (
                <li key={r.id} className="rounded border p-3">
                  <div className="flex items-center justify-between">
                    <span>
                      {personName(r.senderId)} → {personName(r.recipientId)}
                    </span>
                    <Badge variant="outline">{label(r.category)}</Badge>
                  </div>
                  <p className="mt-1">{r.message}</p>
                  {r.departmentId && (
                    <p className="mt-1 text-muted-foreground">
                      Visible to: {departmentName(r.departmentId)}
                    </p>
                  )}
                </li>
              ))}
              {recognitions.length === 0 && (
                <p className="text-muted-foreground">No recognition sent yet.</p>
              )}
            </ul>
          </div>
        </div>
      </div>
    </div>
  )
}
