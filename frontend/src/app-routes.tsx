import { Route, Routes, Navigate } from 'react-router-dom'
import {
  LayoutDashboard,
  Users,
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
import { ShiftPage } from '@/modules/shift'
import { HolidayPage } from '@/modules/holiday'
import { OnboardingPage } from '@/modules/onboarding'
import { PerformancePage } from '@/modules/performance'
import { OffboardingPage } from '@/modules/offboarding'
import { HelpdeskPage } from '@/modules/helpdesk'
import { AnnouncementsPage } from '@/modules/announcements'
import { AnalyticsPage } from '@/modules/analytics'
import { WorkflowPage } from '@/modules/workflow'
import { NotificationsPage } from '@/modules/notifications'
import { SettingsPage } from '@/modules/settings'
import { AuditPage } from '@/modules/audit'
import { RolesPermissionsPage } from '@/modules/permissions'

// Our own separately-built platforms — clicking these nav items leaves the
// HRMS entirely rather than opening an in-app page.
const ASSETS_EXTERNAL_URL = 'https://policyassistant.redrob.io/'
// TODO: replace with the real ATS platform URL once it's ready.
const ATS_EXTERNAL_URL = 'https://ats.redrob.io/'

// Each nav item carries its own icon + accent color so the sidebar reads
// as a set of distinct modules at a glance instead of a plain text list —
// AppShell renders both; nothing here changes routing/visibility.
export const MODULE_NAV = [
  // This task: the app's landing page after login — separate from
  // Analytics, which stays as its own nav item below.
  { path: '/dashboard', label: 'Dashboard', Component: DashboardPage, icon: LayoutDashboard, color: 'text-blue-500' },
  { path: '/employee', label: 'Employee', Component: EmployeePage, icon: Users, color: 'text-indigo-500' },
  { path: '/shift', label: 'Shift & Roster', Component: ShiftPage, icon: CalendarClock, color: 'text-amber-500' },
  // Holiday Calendar: viewable by every authenticated role — HolidayPage
  // itself gates the Publish/Create controls to HR_ADMIN/SUPER_ADMIN
  // internally (isHrAdmin), so no `roles` restriction here or on the route.
  { path: '/holiday', label: 'Holiday Calendar', Component: HolidayPage, icon: CalendarDays, color: 'text-rose-500' },
  // Recruitment (ATS): our own separately-built ATS platform now owns this
  // entirely — clicking the nav item leaves the HRMS. Matches the backend's
  // own @Roles() gate on the (now-unused-internally) ATS endpoints — plain
  // EMPLOYEE accounts still don't get this link.
  {
    path: '/ats',
    label: 'Recruitment (ATS)',
    externalHref: ATS_EXTERNAL_URL,
    icon: Briefcase,
    color: 'text-violet-500',
    roles: ['MANAGER', 'HR_ADMIN', 'SUPER_ADMIN'],
  },
  { path: '/onboarding', label: 'Onboarding', Component: OnboardingPage, icon: UserPlus, color: 'text-teal-500' },
  { path: '/performance', label: 'Performance', Component: PerformancePage, icon: TrendingUp, color: 'text-orange-500' },
  // Assets: our own separately-built asset management platform now owns
  // this entirely — clicking the nav item leaves the HRMS, for every role.
  { path: '/assets', label: 'Assets', externalHref: ASSETS_EXTERNAL_URL, icon: Laptop, color: 'text-cyan-500' },
  { path: '/offboarding', label: 'Offboarding', Component: OffboardingPage, icon: UserMinus, color: 'text-pink-500' },
  { path: '/helpdesk', label: 'Helpdesk', Component: HelpdeskPage, icon: LifeBuoy, color: 'text-sky-500' },
  { path: '/announcements', label: 'Announcements', Component: AnnouncementsPage, icon: Megaphone, color: 'text-fuchsia-500' },
  { path: '/analytics', label: 'Analytics', Component: AnalyticsPage, icon: BarChart3, color: 'text-blue-600' },
  // AI Assistant is a floating chat widget (AppShell), not a sidebar page —
  // no MODULE_NAV entry here on purpose.
  { path: '/workflow', label: 'Workflow', Component: WorkflowPage, icon: GitBranch, color: 'text-lime-600' },
  { path: '/notifications', label: 'Notifications', Component: NotificationsPage, icon: Bell, color: 'text-yellow-500' },
  // Settings is visible to every role — the page itself only fetches/shows
  // company-wide admin sections for HR Admin/Super Admin; everyone else
  // still gets the personal Preferences section (theme, etc.) at the top.
  {
    path: '/settings',
    label: 'Settings',
    Component: SettingsPage,
    icon: Settings,
    color: 'text-slate-500',
  },
  // Audit Logs matches the RequireRole guard already on its <Route> below —
  // without this, a non-admin who clicks it gets silently bounced by
  // RequireRole to "/", which (for an incomplete profile) lands them on the
  // profile-completion page with no explanation of why they ended up there
  // instead of just never seeing a link they can't use.
  {
    path: '/audit',
    label: 'Audit Logs',
    Component: AuditPage,
    icon: ShieldCheck,
    color: 'text-red-500',
    roles: ['HR_ADMIN', 'SUPER_ADMIN'],
  },
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
      {/* No RequireRole here — visible to every role; SettingsPage itself
          only fetches/renders the company-wide admin sections for HR
          Admin/Super Admin. */}
      <Route path="/settings" element={<SettingsPage />} />
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
      {/* Assets and Recruitment (ATS) have no in-app route at all anymore —
          their nav items (see MODULE_NAV) link straight out to our separate
          Asset Management and ATS platforms instead. */}
      {MODULE_NAV.filter(
        (item): item is Extract<(typeof MODULE_NAV)[number], { Component: unknown }> =>
          'Component' in item &&
          !['/employee', '/settings', '/audit', '/roles-permissions'].includes(item.path),
      ).map(({ path, Component }) => (
        <Route key={path} path={path} element={<Component />} />
      ))}
    </Routes>
  )
}
