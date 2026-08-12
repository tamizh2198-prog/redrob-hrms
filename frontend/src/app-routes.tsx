import { Route, Routes, Navigate } from 'react-router-dom'

import {
  EmployeePage,
  EmployeeDetailPage,
  ChangeRequestsPage,
  ProfileCompletionPage,
} from '@/modules/employee'
import { RequireRole } from '@/shared/routes/RequireRole'
import { DashboardPage } from '@/modules/dashboard'
import { AttendanceLeavePage } from '@/modules/attendance'
import { ShiftPage } from '@/modules/shift'
import { HolidayPage } from '@/modules/holiday'
import { AtsPage } from '@/modules/ats'
import { OnboardingPage } from '@/modules/onboarding'
import { PerformancePage } from '@/modules/performance'
import { AssetsPage } from '@/modules/assets'
import { OffboardingPage } from '@/modules/offboarding'
import { HelpdeskPage } from '@/modules/helpdesk'
import { AnnouncementsPage } from '@/modules/announcements'
import { AnalyticsPage } from '@/modules/analytics'
import { AssistantPage } from '@/modules/assistant'
import { WorkflowPage } from '@/modules/workflow'
import { NotificationsPage } from '@/modules/notifications'
import { SettingsPage } from '@/modules/settings'
import { AuditPage } from '@/modules/audit'
import { RolesPermissionsPage } from '@/modules/permissions'

export const MODULE_NAV = [
  // This task: the app's landing page after login — separate from
  // Analytics, which stays as its own nav item below.
  { path: '/dashboard', label: 'Dashboard', Component: DashboardPage },
  { path: '/employee', label: 'Employee', Component: EmployeePage },
  // This task: ONE combined employee self-service nav item, replacing the
  // previously separate Attendance and Leave items. Available to every
  // role (no `roles` restriction) — the page itself shows admin-only
  // sections conditionally based on the logged-in user's role. Nav label
  // shortened to "Attendance" — same route/page/functionality, including
  // Leave, unchanged.
  { path: '/attendance-leave', label: 'Attendance', Component: AttendanceLeavePage },
  { path: '/shift', label: 'Shift & Roster', Component: ShiftPage },
  { path: '/holiday', label: 'Holiday Calendar', Component: HolidayPage },
  { path: '/ats', label: 'Recruitment (ATS)', Component: AtsPage },
  { path: '/onboarding', label: 'Onboarding', Component: OnboardingPage },
  { path: '/performance', label: 'Performance', Component: PerformancePage },
  { path: '/assets', label: 'Assets', Component: AssetsPage },
  { path: '/offboarding', label: 'Offboarding', Component: OffboardingPage },
  { path: '/helpdesk', label: 'Helpdesk', Component: HelpdeskPage },
  { path: '/announcements', label: 'Announcements', Component: AnnouncementsPage },
  { path: '/analytics', label: 'Analytics', Component: AnalyticsPage },
  { path: '/assistant', label: 'AI Assistant', Component: AssistantPage },
  { path: '/workflow', label: 'Workflow', Component: WorkflowPage },
  { path: '/notifications', label: 'Notifications', Component: NotificationsPage },
  { path: '/settings', label: 'Settings', Component: SettingsPage },
  { path: '/audit', label: 'Audit Logs', Component: AuditPage },
  // Auth Phase 5: SUPER_ADMIN only. `roles` is optional on every other
  // entry above (undefined = always visible), so this is additive and
  // does not change how any existing nav item renders.
  {
    path: '/roles-permissions',
    label: 'Roles & Permissions',
    Component: RolesPermissionsPage,
    roles: ['SUPER_ADMIN'],
  },
] as const

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/employee" replace />} />
      <Route path="/employee" element={<EmployeePage />} />
      <Route path="/employee/:id" element={<EmployeeDetailPage />} />
      <Route path="/my-profile" element={<ProfileCompletionPage />} />
      <Route
        path="/employee/change-requests"
        element={
          <RequireRole roles={['HR_ADMIN', 'SUPER_ADMIN']}>
            <ChangeRequestsPage />
          </RequireRole>
        }
      />
      <Route
        path="/settings"
        element={
          <RequireRole roles={['HR_ADMIN', 'SUPER_ADMIN']}>
            <SettingsPage />
          </RequireRole>
        }
      />
      <Route
        path="/audit"
        element={
          <RequireRole roles={['HR_ADMIN', 'SUPER_ADMIN']}>
            <AuditPage />
          </RequireRole>
        }
      />
      <Route
        path="/roles-permissions"
        element={
          <RequireRole roles={['SUPER_ADMIN']}>
            <RolesPermissionsPage />
          </RequireRole>
        }
      />
      {/* This task: /attendance and /leave are compatibility redirects —
          the unified page now lives at /attendance-leave and is reachable
          by every role, so no RequireRole wrapper is needed here. */}
      <Route path="/attendance" element={<Navigate to="/attendance-leave" replace />} />
      <Route path="/leave" element={<Navigate to="/attendance-leave" replace />} />
      {MODULE_NAV.filter(
        ({ path }) => !['/employee', '/settings', '/audit', '/roles-permissions'].includes(path),
      ).map(({ path, Component }) => (
        <Route key={path} path={path} element={<Component />} />
      ))}
    </Routes>
  )
}
