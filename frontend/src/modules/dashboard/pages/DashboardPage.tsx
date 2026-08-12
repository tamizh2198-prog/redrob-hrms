import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
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
  computeDisplayCompletionPercentage,
  type PendingInvitation,
} from '@/modules/employee/api'

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
      <h1 className="text-xl font-semibold">Dashboard</h1>
      <Card>
        <CardHeader>
          <CardTitle>Welcome{user?.name ? `, ${user.name}` : ''}</CardTitle>
          <CardDescription>{user?.role}</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            {user ? ROLE_MESSAGE[user.role] : 'Use the sidebar to get started.'}
          </p>
        </CardContent>
      </Card>
    </div>
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
      <div>
        <h1 className="text-xl font-semibold">Dashboard</h1>
        <p className="text-sm text-muted-foreground">Welcome, {userName}. Here's what needs attention today.</p>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <KpiCard label="Employees" value={totalEmployees} />
        <KpiCard
          label="Today's Attendance"
          value={hrDashboard?.attendancePercentToday == null ? '—' : `${hrDashboard.attendancePercentToday}%`}
        />
        <KpiCard label="On Leave" value={attendanceCount('ON_LEAVE')} />
        <KpiCard label="Onboarding" value={pendingInvitations.length} />
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

function KpiCard({ label, value }: { label: string; value: number | string }) {
  return (
    <Card size="sm">
      <CardContent>
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="text-2xl font-semibold">{value}</div>
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
