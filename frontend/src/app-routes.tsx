import { Route, Routes, Navigate } from 'react-router-dom'

import { EmployeePage } from '@/modules/employee'
import { AttendancePage } from '@/modules/attendance'
import { LeavePage } from '@/modules/leave'
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

export const MODULE_NAV = [
  { path: '/employee', label: 'Employee', Component: EmployeePage },
  { path: '/attendance', label: 'Attendance', Component: AttendancePage },
  { path: '/leave', label: 'Leave', Component: LeavePage },
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
] as const

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/employee" replace />} />
      {MODULE_NAV.map(({ path, Component }) => (
        <Route key={path} path={path} element={<Component />} />
      ))}
    </Routes>
  )
}
