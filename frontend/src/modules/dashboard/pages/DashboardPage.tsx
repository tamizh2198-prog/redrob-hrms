import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Users, UserPlus, type LucideIcon } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
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
import { getDashboard, type Dashboard } from '@/modules/analytics/api'
import {
  listEmployees,
  listPendingInvitations,
  getMyProfile,
  computeDisplayCompletionPercentage,
  type PendingInvitation,
} from '@/modules/employee/api'
import { listCalendar, type Holiday } from '@/modules/holiday/api'
import { listAnnouncements, ackAnnouncement, type Announcement } from '@/modules/announcements/api'

// This task: a simple landing page, separate from Analytics — the
// role-specific content here is just a placeholder message, not a
// duplicate of Analytics' dashboard views/reporting.
const ROLE_MESSAGE: Record<Role, string> = {
  EMPLOYEE: 'Use the sidebar to get started — Shift & Roster, Holiday Calendar, and more.',
  MANAGER: 'Review your team’s pending approvals from the Shift & Roster and Helpdesk sections.',
  HR_ADMIN: 'Manage company-wide HR operations from the modules in the sidebar.',
  SUPER_ADMIN: 'You have full access to every module, including Roles & Permissions.',
  // This task (HR Associate, Phase 3): scoped to the 3 operational modules
  // they have access to — not the Employee Directory or other HR Admin
  // functionality.
  HR_ASSOCIATE: 'Manage Onboarding, Offboarding, and Assets from the sidebar.',
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
          <Link to="/employee">
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
                    {m.firstName} {m.lastName}
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
          <Link to="/announcements">
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
                  <span className="font-medium">{a.title}</span>
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
          <Link to="/holiday">
            <Button variant="outline" size="sm">
              View Holiday Calendar
            </Button>
          </Link>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {upcoming.map((h) => (
          <div key={h.id} className="flex items-center justify-between text-sm">
            <span>
              {formatHolidayDate(h.date)} — {h.name}
            </span>
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
        <KpiCard label="Employees" value={totalEmployees} icon={Users} color="text-indigo-500" />
        <KpiCard label="Onboarding" value={pendingInvitations.length} icon={UserPlus} color="text-teal-500" />
      </div>

      <UpcomingHolidays />

      {/* Onboarding summary */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Onboarding</CardTitle>
            <Link to="/onboarding">
              <Button variant="outline" size="sm">View Onboarding</Button>
            </Link>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-6 text-sm">
            <SummaryStat label="Pending Invitations" value={pendingInvitations.length} />
            <SummaryStat label="Incomplete Profiles" value={incompleteProfiles} />
          </div>
        </CardContent>
      </Card>

      {/* Employee summary */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Employees</CardTitle>
            <Link to="/employee">
              <Button variant="outline" size="sm">View Employees</Button>
            </Link>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-6 text-sm">
            <SummaryStat label="Total" value={totalEmployees} />
            <SummaryStat label="Active" value={activeEmployees} />
            <SummaryStat label="Invited" value={invitedEmployees} />
            <SummaryStat label="Terminated" value={terminatedEmployees} />
          </div>
        </CardContent>
      </Card>

      {/* Quick Actions */}
      <Card>
        <CardHeader>
          <CardTitle>Quick Actions</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Link to="/employee">
            <Button variant="outline">+ Create Employee</Button>
          </Link>
          <Link to="/employee">
            <Button variant="outline">View Employees</Button>
          </Link>
          <Link to="/shift">
            <Button variant="outline">Shift & Roster</Button>
          </Link>
          <Link to="/onboarding">
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
}: {
  label: string
  value: number | string
  icon: LucideIcon
  color: string
}) {
  return (
    <Card size="sm">
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
}

function SummaryStat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-md bg-muted px-3 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
    </div>
  )
}
