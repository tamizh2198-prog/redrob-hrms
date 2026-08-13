import { Route, Routes, Navigate } from 'react-router-dom'
import {
  LayoutDashboard,
  Users,
  Clock,
  CalendarClock,
  CalendarDays,
  Briefcase,
  UserPlus,
  TrendingUp,
  Laptop,
  UserMinus,
  LifeBuoy,
  Megaphone,
  BarChart3,
  GitBranch,
  Bell,
  Settings,
  ShieldCheck,
  KeyRound,
} from 'lucide-react'

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
import { WorkflowPage } from '@/modules/workflow'
import { NotificationsPage } from '@/modules/notifications'
import { SettingsPage } from '@/modules/settings'
import { AuditPage } from '@/modules/audit'
import { RolesPermissionsPage } from '@/modules/permissions'

// Each nav item carries its own icon + accent color so the sidebar reads
// as a set of distinct modules at a glance instead of a plain text list —
// AppShell renders both; nothing here changes routing/visibility.
export const MODULE_NAV = [
  // This task: the app's landing page after login — separate from
  // Analytics, which stays as its own nav item below.
  { path: '/dashboard', label: 'Dashboard', Component: DashboardPage, icon: LayoutDashboard, color: 'text-blue-500' },
  { path: '/employee', label: 'Employee', Component: EmployeePage, icon: Users, color: 'text-indigo-500' },
  // This task: ONE combined employee self-service nav item, replacing the
  // previously separate Attendance and Leave items. Available to every
  // role (no `roles` restriction) — the page itself shows admin-only
  // sections conditionally based on the logged-in user's role. Nav label
  // shortened to "Attendance" — same route/page/functionality, including
  // Leave, unchanged.
  { path: '/attendance-leave', label: 'Attendance', Component: AttendanceLeavePage, icon: Clock, color: 'text-emerald-500' },
  { path: '/shift', label: 'Shift & Roster', Component: ShiftPage, icon: CalendarClock, color: 'text-amber-500' },
  { path: '/holiday', label: 'Holiday Calendar', Component: HolidayPage, icon: CalendarDays, color: 'text-rose-500' },
  // Matches the backend's own @Roles() gate on every ATS endpoint — plain
  // EMPLOYEE accounts have no recruitment access at all, so the nav item
  // shouldn't be shown to them either.
  {
    path: '/ats',
    label: 'Recruitment (ATS)',
    Component: AtsPage,
    icon: Briefcase,
    color: 'text-violet-500',
    roles: ['MANAGER', 'HR_ADMIN', 'SUPER_ADMIN'],
  },
  { path: '/onboarding', label: 'Onboarding', Component: OnboardingPage, icon: UserPlus, color: 'text-teal-500' },
  { path: '/performance', label: 'Performance', Component: PerformancePage, icon: TrendingUp, color: 'text-orange-500' },
  { path: '/assets', label: 'Assets', Component: AssetsPage, icon: Laptop, color: 'text-cyan-500' },
  { path: '/offboarding', label: 'Offboarding', Component: OffboardingPage, icon: UserMinus, color: 'text-pink-500' },
  { path: '/helpdesk', label: 'Helpdesk', Component: HelpdeskPage, icon: LifeBuoy, color: 'text-sky-500' },
  { path: '/announcements', label: 'Announcements', Component: AnnouncementsPage, icon: Megaphone, color: 'text-fuchsia-500' },
  { path: '/analytics', label: 'Analytics', Component: AnalyticsPage, icon: BarChart3, color: 'text-blue-600' },
  { path: '/workflow', label: 'Workflow', Component: WorkflowPage, icon: GitBranch, color: 'text-lime-600' },
  { path: '/notifications', label: 'Notifications', Component: NotificationsPage, icon: Bell, color: 'text-yellow-500' },
  { path: '/settings', label: 'Settings', Component: SettingsPage, icon: Settings, color: 'text-slate-500' },
  { path: '/audit', label: 'Audit Logs', Component: AuditPage, icon: ShieldCheck, color: 'text-red-500' },
  // Auth Phase 5: SUPER_ADMIN only. `roles` is optional on every other
  // entry above (undefined = always visible), so this is additive and
  // does not change how any existing nav item renders.
  {
    path: '/roles-permissions',
    label: 'Roles & Permissions',
    Component: RolesPermissionsPage,
    icon: KeyRound,
    color: 'text-purple-500',
    roles: ['SUPER_ADMIN'],
  },
] as const

// Auth Phase 3: an incomplete profile lands the employee on the
// completion page by default instead of the usual directory — but every
// other route/nav link still works normally below, so sign-out and
// switching modules are never blocked by an incomplete profile.
export function AppRoutes({ profileIncomplete = false }: { profileIncomplete?: boolean }) {
  return (
    <Routes>
      <Route
        path="/"
        element={<Navigate to={profileIncomplete ? '/my-profile' : '/employee'} replace />}
      />
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
      <Route
        path="/ats"
        element={
          <RequireRole roles={['MANAGER', 'HR_ADMIN', 'SUPER_ADMIN']}>
            <AtsPage />
          </RequireRole>
        }
      />
      {/* This task: /attendance and /leave are compatibility redirects —
          the unified page now lives at /attendance-leave and is reachable
          by every role, so no RequireRole wrapper is needed here. */}
      <Route path="/attendance" element={<Navigate to="/attendance-leave" replace />} />
      <Route path="/leave" element={<Navigate to="/attendance-leave" replace />} />
      {MODULE_NAV.filter(
        ({ path }) =>
          !['/employee', '/settings', '/audit', '/roles-permissions', '/ats'].includes(path),
      ).map(({ path, Component }) => (
        <Route key={path} path={path} element={<Component />} />
      ))}
    </Routes>
  )
}
