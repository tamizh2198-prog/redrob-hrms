import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useAuth } from '@/shared/auth/AuthContext'
import type { Role } from '@/shared/auth/role'

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
