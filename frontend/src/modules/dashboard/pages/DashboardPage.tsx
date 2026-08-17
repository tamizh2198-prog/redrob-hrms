import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Users, CalendarCheck, Palmtree, UserPlus, type LucideIcon } from 'lucide-react'
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
import { ApiError } from '@/lib/api'
import { getDashboard, type Dashboard } from '@/modules/analytics/api'
import { decideLeave, listPendingRequests, isHalfDayApplication, type LeaveApplication } from '@/modules/leave/api'
import {
  listEmployees,
  listPendingInvitations,
  getMyProfile,
  computeDisplayCompletionPercentage,
  type PendingInvitation,
} from '@/modules/employee/api'
import { listCalendar, type Holiday } from '@/modules/holiday/api'
import { listAnnouncements, ackAnnouncement, type Announcement } from '@/modules/announcements/api'
import { CompOffCard } from '@/modules/leave/components/CompOffCard'

// This task: a simple landing page, separate from Analytics — the
// role-specific content here is just a placeholder message, not a
// duplicate of Analytics' dashboard views/reporting.
const ROLE_MESSAGE: Record<Role, string> = {
  EMPLOYEE: 'Mark your attendance and manage leave from the Attendance section in the sidebar.',
  MANAGER: 'Review your team’s pending approvals from the Attendance and Helpdesk sections.',
  HR_ADMIN: 'Manage company-wide HR operations from the modules in the sidebar.',
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
      {user?.role === 'MANAGER' && <MyTeamCard />}
      <CompOffCard />
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
// app (Analytics dashboard, leave pending-requests, employee list/
// invitations) — nothing new is computed on the backend. Full workflows
// stay on their existing pages (Employee Directory, Attendance & Leave,
// Onboarding); this page only summarizes + links out.
function SuperAdminDashboard({ userName }: { userName: string }) {
  const [dashboard, setDashboard] = useState<Dashboard | null>(null)
  const [companyPending, setCompanyPending] = useState<LeaveApplication[]>([])
  const [pendingInvitations, setPendingInvitations] = useState<PendingInvitation[]>([])
  const [incompleteProfiles, setIncompleteProfiles] = useState(0)
  const [decidingId, setDecidingId] = useState<string | null>(null)
  const [leaveMessage, setLeaveMessage] = useState<string | null>(null)
  const [leaveError, setLeaveError] = useState<string | null>(null)

  function loadPendingLeave() {
    return listPendingRequests().then(setCompanyPending).catch(() => setCompanyPending([]))
  }

  useEffect(() => {
    getDashboard().then(setDashboard).catch(() => setDashboard(null))
    loadPendingLeave()
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

  async function handleLeaveDecision(id: string, approve: boolean) {
    setDecidingId(id)
    setLeaveError(null)
    setLeaveMessage(null)
    try {
      await decideLeave(id, approve)
      await Promise.all([
        loadPendingLeave(),
        getDashboard().then(setDashboard).catch(() => setDashboard(null)),
      ])
      setLeaveMessage(approve ? 'Leave request approved.' : 'Leave request rejected.')
    } catch (err) {
      setLeaveError(err instanceof ApiError ? err.message : 'Failed to record decision')
    } finally {
      setDecidingId(null)
    }
  }

  const hrDashboard =
    dashboard && (dashboard.role === 'HR_ADMIN' || dashboard.role === 'SUPER_ADMIN') ? dashboard : null

  function headcount(status: string) {
    return hrDashboard?.headcountByStatus.find((h) => h.status === status)?.count ?? 0
  }
  const totalEmployees = hrDashboard?.headcountByStatus.reduce((sum, h) => sum + h.count, 0) ?? 0
  const activeEmployees = headcount('ACTIVE') + headcount('ACTIVE_PROBATION')
  const invitedEmployees = headcount('INVITED')
  const terminatedEmployees = headcount('TERMINATED')

  function attendanceCount(status: string) {
    return hrDashboard?.attendanceToday.find((a) => a.status === status)?.count ?? 0
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <WelcomeBanner name={userName} role="SUPER_ADMIN" />
      <HighPriorityAnnouncements />

      {/* KPI cards */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <KpiCard label="Employees" value={totalEmployees} icon={Users} color="text-indigo-500" />
        <KpiCard
          label="Today's Attendance"
          value={hrDashboard?.attendancePercentToday == null ? '—' : `${hrDashboard.attendancePercentToday}%`}
          icon={CalendarCheck}
          color="text-emerald-500"
        />
        <KpiCard label="On Leave" value={attendanceCount('ON_LEAVE')} icon={Palmtree} color="text-amber-500" />
        <KpiCard label="Onboarding" value={pendingInvitations.length} icon={UserPlus} color="text-teal-500" />
      </div>

      {/* Today's Attendance summary */}
      <Card>
        <CardHeader>
          <CardTitle>Today's Attendance</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-6 text-sm">
            <SummaryStat label="Present" value={attendanceCount('PRESENT')} />
            <SummaryStat label="Absent" value={attendanceCount('ABSENT')} />
            <SummaryStat label="On Leave" value={attendanceCount('ON_LEAVE')} />
            <SummaryStat label="Half Day" value={attendanceCount('HALF_DAY')} />
            <SummaryStat label="Late" value={attendanceCount('LATE')} />
          </div>
        </CardContent>
      </Card>

      <UpcomingHolidays />

      {/* Pending Leave Requests — moved here from Attendance (Super Admin only) */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Pending Leave Requests</CardTitle>
            <Link to="/attendance-leave">
              <Button variant="outline" size="sm">View All</Button>
            </Link>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {leaveMessage && <p className="text-sm text-primary">{leaveMessage}</p>}
          {leaveError && <p className="text-sm text-destructive">{leaveError}</p>}
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee</TableHead>
                  <TableHead>Leave Type</TableHead>
                  <TableHead>Date(s)</TableHead>
                  <TableHead>Days</TableHead>
                  <TableHead>Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {companyPending.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell>
                      {a.employee?.firstName} {a.employee?.lastName}
                    </TableCell>
                    <TableCell>{a.leaveType?.name ?? '—'}</TableCell>
                    <TableCell>
                      {a.startDate.slice(0, 10)}
                      {a.startDate !== a.endDate && ` → ${a.endDate.slice(0, 10)}`}
                    </TableCell>
                    <TableCell>{isHalfDayApplication(a) ? 'Half Day' : a.daysCount}</TableCell>
                    <TableCell className="flex gap-2">
                      <Button
                        size="sm"
                        disabled={decidingId === a.id}
                        onClick={() => handleLeaveDecision(a.id, true)}
                      >
                        Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        disabled={decidingId === a.id}
                        onClick={() => handleLeaveDecision(a.id, false)}
                      >
                        Reject
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {companyPending.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-muted-foreground">
                      No pending leave requests.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

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
          <Link to="/attendance-leave">
            <Button variant="outline">Attendance</Button>
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
