"use client"

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Users, UserPlus, ArrowRight, CornerDownRight, type LucideIcon } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { WelcomeBanner } from '../components/WelcomeBanner'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useAuth } from '@/shared/auth/AuthContext'
import type { Role } from '@/shared/auth/role'
import { ApiError } from '@/lib/api'
import { getDashboard, type Dashboard } from '@/modules/analytics/api'
import {
  listEmployees,
  listPendingInvitations,
  getMyProfile,
  getOrgChart,
  getMyDepartmentColleagues,
  computeDisplayCompletionPercentage,
  type PendingInvitation,
  type OrgChartResponse,
  type DepartmentColleague,
} from '@/modules/employee/api'
import { listCalendar, type Holiday } from '@/modules/holiday/api'
import { listAnnouncements, ackAnnouncement, type Announcement } from '@/modules/announcements/api'
import {
  getMyProbationFeedback,
  submitProbationFeedback,
  type ProbationFeedback,
} from '@/modules/onboarding/api'

// This task: a simple landing page, separate from Analytics — the
// role-specific content here is just a placeholder message, not a
// duplicate of Analytics' dashboard views/reporting.
const ROLE_MESSAGE: Record<Role, string> = {
  EMPLOYEE: 'Use the sidebar to get started — Shift & Roster, Holiday Calendar, and more.',
  MANAGER: 'Review your team’s pending approvals from the Shift & Roster and Helpdesk sections.',
  HR_ADMIN: 'Manage company-wide HR operations from the modules in the sidebar.',
  HR_ASSOCIATE: 'Manage company-wide HR operations from the modules in the sidebar.',
  SUPER_ADMIN: 'You have full access to every module, including Roles & Permissions.',
}

export function DashboardPage() {
  const { user } = useAuth()

  if (user?.role === 'SUPER_ADMIN') {
    return <SuperAdminDashboard userName={user.name} />
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <WelcomeBanner name={user?.name} role={user?.role} />
      <HighPriorityAnnouncements />
      <ProbationFeedbackCard />
      {user?.id && <MyReportingAndDepartmentCard employeeId={user.id} />}
      {user?.role === 'MANAGER' && <MyTeamCard />}
      <Card>
        <CardHeader>
          <CardTitle>Getting Started</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            {user ? ROLE_MESSAGE[user.role] : 'Use the sidebar to get started.'}
          </p>
        </CardContent>
      </Card>
      <UpcomingHolidays />
    </div>
  )
}

// This task: managers/leads get an at-a-glance roster of who reports to
// them (direct + indirect), so they can keep track of their team without
// leaving the dashboard. Sourced from the existing Manager dashboard
// endpoint (Analytics) — teamMembers is just a fuller field alongside the
// counts/aggregates that endpoint already returns, no new backend model.
function MyTeamCard() {
  const [dashboard, setDashboard] = useState<Dashboard | null>(null)

  useEffect(() => {
    getDashboard().then(setDashboard).catch(() => setDashboard(null))
  }, [])

  const team = dashboard && dashboard.role === 'MANAGER' ? dashboard.teamMembers : []

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>My Team</CardTitle>
          <Link href="/employee">
            <Button variant="outline" size="sm">View All</Button>
          </Link>
        </div>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Employee Code</TableHead>
                <TableHead>Designation</TableHead>
                <TableHead>Department</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {team.map((m) => (
                <TableRow key={m.id}>
                  <TableCell>
                    <Link href={`/employee/${m.id}`} className="underline-offset-4 hover:underline">
                      {m.firstName} {m.lastName}
                    </Link>
                  </TableCell>
                  <TableCell>{m.employeeCode}</TableCell>
                  <TableCell>{m.designation ?? '—'}</TableCell>
                  <TableCell>{m.department ?? '—'}</TableCell>
                  <TableCell>
                    <Badge variant={m.status === 'ACTIVE' ? 'default' : 'outline'}>
                      {m.status}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
              {team.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground">
                    No reportees yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  )
}

const RATING_OPTIONS = [1, 2, 3, 4, 5]

// Only renders once a checkpoint has actually come due (reminderSentAt is
// set server-side) and hasn't been answered yet — otherwise nothing shows,
// same "quiet unless something's pending" idiom as HighPriorityAnnouncements.
function ProbationFeedbackCard() {
  const [pending, setPending] = useState<ProbationFeedback | null>(null)
  const [companyRating, setCompanyRating] = useState('')
  const [workCultureRating, setWorkCultureRating] = useState('')
  const [comments, setComments] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    getMyProbationFeedback()
      .then((rows) => setPending(rows.find((r) => r.reminderSentAt && !r.submittedAt) ?? null))
      .catch(() => setPending(null))
  }, [])

  if (!pending) return null

  async function handleSubmit() {
    if (!pending || !companyRating || !workCultureRating) return
    setError(null)
    setSubmitting(true)
    try {
      await submitProbationFeedback(pending.id, {
        companyRating: Number(companyRating),
        workCultureRating: Number(workCultureRating),
        comments: comments || undefined,
      })
      setPending(null)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to submit feedback')
    } finally {
      setSubmitting(false)
    }
  }

  const checkpointLabel = pending.checkpoint.replace('_', ' ').toLowerCase()

  return (
    <Card>
      <CardHeader>
        <CardTitle>How&apos;s it going so far?</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        <p className="text-muted-foreground">
          You&apos;re at your {checkpointLabel} check-in — a couple of quick questions on the company and
          work culture so far.
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">Company (1-5)</label>
            <Select value={companyRating} onValueChange={(v) => setCompanyRating(v ?? '')}>
              <SelectTrigger className="w-28">
                <SelectValue placeholder="Rate" />
              </SelectTrigger>
              <SelectContent>
                {RATING_OPTIONS.map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    {n}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">Work culture (1-5)</label>
            <Select value={workCultureRating} onValueChange={(v) => setWorkCultureRating(v ?? '')}>
              <SelectTrigger className="w-28">
                <SelectValue placeholder="Rate" />
              </SelectTrigger>
              <SelectContent>
                {RATING_OPTIONS.map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    {n}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <Textarea
          placeholder="Anything you'd like to share (optional)"
          value={comments}
          onChange={(e) => setComments(e.target.value)}
        />
        {error && <p className="text-destructive">{error}</p>}
        <Button
          size="sm"
          className="self-start"
          disabled={submitting || !companyRating || !workCultureRating}
          onClick={handleSubmit}
        >
          {submitting ? 'Submitting…' : 'Submit Feedback'}
        </Button>
      </CardContent>
    </Card>
  )
}

// Surfaces two things every employee could previously only find by opening
// their own Employee Detail page: their reporting chain (up through
// managers, plus their own direct reports) and who else is in their
// department. Both endpoints are already self-scoped server-side — this
// component just puts them somewhere more visible than a buried tab.
function MyReportingAndDepartmentCard({ employeeId }: { employeeId: string }) {
  const [orgChart, setOrgChart] = useState<OrgChartResponse | null>(null)
  const [colleagues, setColleagues] = useState<DepartmentColleague[]>([])

  useEffect(() => {
    getOrgChart(employeeId).then(setOrgChart).catch(() => setOrgChart(null))
    getMyDepartmentColleagues().then(setColleagues).catch(() => setColleagues([]))
  }, [employeeId])

  if (!orgChart && colleagues.length === 0) return null

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {orgChart && (
        <Card>
          <CardHeader>
            <CardTitle>My Reporting Chain</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4 text-sm">
            <div>
              <p className="mb-1 text-xs font-medium text-muted-foreground">Reports up to</p>
              {orgChart.managers.length > 0 ? (
                // Non-clickable on purpose — a plain employee viewing their
                // own manager's (or skip-level's) record 403s server-side,
                // so this is flow-only, not a navigation shortcut.
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge variant="outline">You</Badge>
                  {orgChart.managers.map((m) => (
                    <span key={m.id} className="flex items-center gap-1.5">
                      <ArrowRight className="size-3.5 text-muted-foreground" />
                      <Badge variant="outline">
                        {m.firstName} {m.lastName}
                      </Badge>
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-muted-foreground">No manager on file.</p>
              )}
            </div>
            <div>
              <p className="mb-1 text-xs font-medium text-muted-foreground">Direct reports</p>
              {orgChart.directReports.length > 0 ? (
                <ul className="flex flex-col gap-1">
                  {orgChart.directReports.map((r) => (
                    <li key={r.id} className="flex items-center gap-1.5">
                      <CornerDownRight className="size-3.5 shrink-0 text-muted-foreground" />
                      <Link href={`/employee/${r.id}`} className="underline-offset-4 hover:underline">
                        {r.firstName} {r.lastName} ({r.employeeCode})
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-muted-foreground">No direct reports.</p>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {colleagues.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>My Department</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-1 text-sm">
              {colleagues.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-3">
                  <span className="min-w-0 flex-1 truncate font-medium">
                    {c.firstName} {c.lastName}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-muted-foreground">
                    {c.designation?.name ?? ''}
                  </span>
                  <Badge variant={c.status === 'TERMINATED' ? 'destructive' : 'outline'}>
                    {c.status}
                  </Badge>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

// This task: every role gets a heads-up on HIGH priority announcements right
// on login, rather than only discovering them by visiting the Announcements
// page. Reuses the existing GET /announcements (already scope-filtered
// server-side) — no new backend endpoint or priority-specific query param.
function HighPriorityAnnouncements() {
  const [announcements, setAnnouncements] = useState<Announcement[]>([])
  const [ackingId, setAckingId] = useState<string | null>(null)

  function refresh() {
    listAnnouncements().then(setAnnouncements).catch(() => setAnnouncements([]))
  }

  useEffect(() => {
    refresh()
  }, [])

  const highPriority = announcements
    .filter((a) => a.priority === 'HIGH')
    .slice(0, 5)

  async function handleAck(id: string) {
    setAckingId(id)
    try {
      await ackAnnouncement(id)
      refresh()
    } finally {
      setAckingId(null)
    }
  }

  if (highPriority.length === 0) return null

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>High Priority Announcements</CardTitle>
          <Link href="/announcements">
            <Button variant="outline" size="sm">View All</Button>
          </Link>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {highPriority.map((a) => (
          <div key={a.id} className="rounded-md border border-destructive/30 bg-destructive/5 p-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <Link href="/announcements" className="font-medium underline-offset-4 hover:underline">
                    {a.title}
                  </Link>
                  <Badge variant="destructive">High Priority</Badge>
                </div>
                <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{a.body}</p>
              </div>
              {a.requiresAck && !a.myAck?.acknowledgedAt && (
                <Button
                  size="sm"
                  disabled={ackingId === a.id}
                  onClick={() => handleAck(a.id)}
                >
                  Acknowledge
                </Button>
              )}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

function formatHolidayDate(iso: string): string {
  const d = new Date(iso)
  const day = String(d.getUTCDate()).padStart(2, '0')
  const month = d.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' })
  return `${day} ${month}`
}

// This task: every authenticated user gets a read-only "Upcoming Holidays"
// summary, reusing the same GET /holidays/calendar endpoint and Holiday
// Calendar page already built — not a new holiday API or a second data
// source.
function UpcomingHolidays() {
  const [holidays, setHolidays] = useState<Holiday[]>([])

  useEffect(() => {
    getMyProfile()
      .then((profile) => {
        const locationId = profile.employee.locationId
        if (!locationId) {
          setHolidays([])
          return
        }
        const year = new Date().getFullYear()
        Promise.all([listCalendar(locationId, year), listCalendar(locationId, year + 1)])
          .then(([thisYear, nextYear]) => setHolidays([...thisYear, ...nextYear]))
          .catch(() => setHolidays([]))
      })
      .catch(() => setHolidays([]))
  }, [])

  const today = new Date().toISOString().slice(0, 10)
  const upcoming = holidays
    .filter((h) => h.date.slice(0, 10) >= today)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 5)

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Upcoming Holidays</CardTitle>
          <Link href="/holiday">
            <Button variant="outline" size="sm">
              View Holiday Calendar
            </Button>
          </Link>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {upcoming.map((h) => (
          <div key={h.id} className="flex items-center justify-between gap-3 text-sm">
            <span className="min-w-20 shrink-0 text-muted-foreground">{formatHolidayDate(h.date)}</span>
            <span className="min-w-0 flex-1 truncate">{h.name}</span>
            {h.isOptional && <Badge variant="outline">Optional</Badge>}
          </div>
        ))}
        {upcoming.length === 0 && (
          <p className="text-sm text-muted-foreground">No upcoming holidays.</p>
        )}
      </CardContent>
    </Card>
  )
}

// This task: Super Admin's "what needs attention" summary. Every number and
// row here comes from existing endpoints already used elsewhere in the
// app (Analytics dashboard, employee list/invitations) — nothing new is
// computed on the backend. Full workflows stay on their existing pages
// (Employee Directory, Shift & Roster, Onboarding); this page only
// summarizes + links out.
function SuperAdminDashboard({ userName }: { userName: string }) {
  const [dashboard, setDashboard] = useState<Dashboard | null>(null)
  const [pendingInvitations, setPendingInvitations] = useState<PendingInvitation[]>([])
  const [incompleteProfiles, setIncompleteProfiles] = useState(0)

  useEffect(() => {
    getDashboard().then(setDashboard).catch(() => setDashboard(null))
    listPendingInvitations().then(setPendingInvitations).catch(() => setPendingInvitations([]))
    // Reuses the same existing /employees list + the existing display-completion
    // utility EmployeePage already uses — no new backend metric.
    listEmployees({ pageSize: 1000 })
      .then((res) =>
        setIncompleteProfiles(
          res.items.filter((e) => computeDisplayCompletionPercentage(e) < 100).length,
        ),
      )
      .catch(() => setIncompleteProfiles(0))
  }, [])

  const hrDashboard =
    dashboard && (dashboard.role === 'HR_ADMIN' || dashboard.role === 'SUPER_ADMIN') ? dashboard : null

  function headcount(status: string) {
    return hrDashboard?.headcountByStatus.find((h) => h.status === status)?.count ?? 0
  }
  const totalEmployees = hrDashboard?.headcountByStatus.reduce((sum, h) => sum + h.count, 0) ?? 0
  const activeEmployees = headcount('ACTIVE') + headcount('ACTIVE_PROBATION')
  const invitedEmployees = headcount('INVITED')
  const terminatedEmployees = headcount('TERMINATED')

  return (
    <div className="flex flex-col gap-6 p-6">
      <WelcomeBanner name={userName} role="SUPER_ADMIN" />
      <HighPriorityAnnouncements />

      {/* KPI cards */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <KpiCard label="Employees" value={totalEmployees} icon={Users} color="text-indigo-500" to="/employee" />
        <KpiCard label="Onboarding" value={pendingInvitations.length} icon={UserPlus} color="text-teal-500" to="/onboarding" />
      </div>

      <UpcomingHolidays />

      {/* Onboarding summary */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Onboarding</CardTitle>
            <Link href="/onboarding">
              <Button variant="outline" size="sm">View Onboarding</Button>
            </Link>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-6 text-sm">
            <SummaryStat label="Pending Invitations" value={pendingInvitations.length} to="/onboarding" />
            <SummaryStat label="Incomplete Profiles" value={incompleteProfiles} to="/employee" />
          </div>
        </CardContent>
      </Card>

      {/* Employee summary */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Employees</CardTitle>
            <Link href="/employee">
              <Button variant="outline" size="sm">View Employees</Button>
            </Link>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-6 text-sm">
            <SummaryStat label="Total" value={totalEmployees} to="/employee" />
            <SummaryStat label="Active" value={activeEmployees} to="/employee?status=ACTIVE" />
            <SummaryStat label="Invited" value={invitedEmployees} to="/employee?status=INVITED" />
            <SummaryStat label="Terminated" value={terminatedEmployees} to="/employee?status=TERMINATED" />
          </div>
        </CardContent>
      </Card>

      {/* Quick Actions */}
      <Card>
        <CardHeader>
          <CardTitle>Quick Actions</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Link href="/employee">
            <Button variant="outline">+ Create Employee</Button>
          </Link>
          <Link href="/employee">
            <Button variant="outline">View Employees</Button>
          </Link>
          <Link href="/shift">
            <Button variant="outline">Shift & Roster</Button>
          </Link>
          <Link href="/onboarding">
            <Button variant="outline">Onboarding</Button>
          </Link>
        </CardContent>
      </Card>
    </div>
  )
}

function KpiCard({
  label,
  value,
  icon: Icon,
  color,
  to,
}: {
  label: string
  value: number | string
  icon: LucideIcon
  color: string
  to?: string
}) {
  const content = (
    <Card size="sm" className={to ? 'transition-colors hover:bg-muted/50' : undefined}>
      <CardContent className="flex items-center gap-3">
        <div className={`flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted ${color}`}>
          <Icon className="size-5" />
        </div>
        <div>
          <div className="text-xs text-muted-foreground">{label}</div>
          <div className="text-2xl font-semibold">{value}</div>
        </div>
      </CardContent>
    </Card>
  )
  return to ? <Link href={to}>{content}</Link> : content
}

function SummaryStat({
  label,
  value,
  to,
}: {
  label: string
  value: number | string
  to?: string
}) {
  const content = (
    <div className={`rounded-md bg-muted px-3 py-2 ${to ? 'transition-colors hover:bg-muted/70' : ''}`}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
    </div>
  )
  return to ? <Link href={to}>{content}</Link> : content
}
