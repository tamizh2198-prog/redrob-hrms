import type { LucideIcon } from 'lucide-react'
import { LayoutDashboard, Users, CalendarClock, CalendarDays, UserPlus, GraduationCap, TrendingUp, GitBranch, UserMinus, Laptop, Briefcase, LifeBuoy, Megaphone, BarChart3, Settings, ShieldCheck, KeyRound } from 'lucide-react'
import type { Role } from '@/shared/auth/role'

interface ModuleNavItem {
  path: string
  label: string
  icon: LucideIcon
  color: string
  roles?: readonly Role[]
  /** Links out to a separately-built platform instead of an in-app route. */
  externalHref?: string
}

// Assets and Recruitment (ATS) have no in-app route at all — they link
// straight out to the separately-built Asset Management and ATS platforms,
// mirroring frontend/src/app-routes.tsx exactly (AtsPage/OfferTemplateManager
// exist in frontend/src/modules/ats but are unrouted dead code there too).
const ATS_EXTERNAL_URL = 'https://redrob-ats.vercel.app/login?next=%2F'
const ASSETS_EXTERNAL_URL = 'https://policyassistant.redrob.io/'

// Mirrors the original frontend/src/app-routes.tsx's MODULE_NAV — this is
// the sidebar's single source of truth (icon + accent color per module).
// TODO(migration): add an entry here as each remaining module ports
// (Analytics, Settings, Audit, Roles & Permissions) — see
// frontend/src/app-routes.tsx for the full, original list.
export const MODULE_NAV: ModuleNavItem[] = [
  { path: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, color: 'text-blue-500' },
  { path: '/employee', label: 'Employee', icon: Users, color: 'text-indigo-500' },
  { path: '/shift', label: 'Shift & Roster', icon: CalendarClock, color: 'text-amber-500' },
  { path: '/holiday', label: 'Holiday Calendar', icon: CalendarDays, color: 'text-rose-500' },
  { path: '/onboarding', label: 'Onboarding', icon: UserPlus, color: 'text-teal-500' },
  { path: '/learning', label: 'Learning', icon: GraduationCap, color: 'text-emerald-600' },
  { path: '/performance', label: 'Performance', icon: TrendingUp, color: 'text-orange-500' },
  { path: '/workflow', label: 'Workflow', icon: GitBranch, color: 'text-lime-600' },
  { path: '/offboarding', label: 'Offboarding', icon: UserMinus, color: 'text-pink-500' },
  { path: '/helpdesk', label: 'Helpdesk', icon: LifeBuoy, color: 'text-sky-500' },
  { path: '/announcements', label: 'Announcements', icon: Megaphone, color: 'text-fuchsia-500' },
  { path: '/analytics', label: 'Analytics', icon: BarChart3, color: 'text-blue-600' },
  // Settings is visible to every role — the page itself only fetches/shows
  // company-wide admin sections for HR Admin/Super Admin; everyone else
  // still gets the personal Preferences section (theme, etc.) at the top.
  { path: '/settings', label: 'Settings', icon: Settings, color: 'text-slate-500' },
  // Matches the backend's own @Roles(HR_ADMIN, HR_ASSOCIATE, SUPER_ADMIN)
  // gate on both audit-logs routes — without this restriction a Manager/
  // Employee would see a link that always 403s.
  {
    path: '/audit',
    label: 'Audit Logs',
    icon: ShieldCheck,
    color: 'text-red-500',
    roles: ['HR_ADMIN', 'HR_ASSOCIATE', 'SUPER_ADMIN'],
  },
  // SUPER_ADMIN only. `roles` is optional on every other entry above
  // (undefined = always visible), so this is additive and does not change
  // how any existing nav item renders.
  {
    path: '/roles-permissions',
    label: 'Roles & Permissions',
    icon: KeyRound,
    color: 'text-purple-500',
    roles: ['SUPER_ADMIN'],
  },
  {
    path: '/ats',
    label: 'Recruitment (ATS)',
    externalHref: ATS_EXTERNAL_URL,
    icon: Briefcase,
    color: 'text-violet-500',
    roles: ['MANAGER', 'HR_ADMIN', 'HR_ASSOCIATE', 'SUPER_ADMIN'],
  },
  { path: '/assets', label: 'Assets', externalHref: ASSETS_EXTERNAL_URL, icon: Laptop, color: 'text-cyan-500' },
]
