import { useState, type ReactNode } from 'react'
import { Link, NavLink, useNavigate } from 'react-router-dom'
import { Bell, KeyRound, LayoutDashboard, LogOut, Menu, Settings, User, UserCircle, X } from 'lucide-react'
import { MODULE_NAV } from '@/app-routes'
import { FloatingAssistant } from '@/modules/assistant'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useAuth } from '@/shared/auth/AuthContext'
import { ChangePasswordDialog } from '@/shared/auth/ChangePasswordDialog'
import logo from '@/assets/logo.jpg'

// This task: Profile, Notifications, and Settings move from the sidebar
// into a top-right header/dropdown — same /my-profile, /notifications, and
// /settings routes, same MODULE_NAV entries (still rendered by
// app-routes.tsx), just no longer listed as sidebar links.
const HEADER_ONLY_NAV_PATHS = new Set(['/notifications', '/settings'])

export function AppShell({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const [changePasswordOpen, setChangePasswordOpen] = useState(false)
  // Sidebar is a permanent w-56 column on md+ screens, same as before. Below
  // that (phones), it's an off-canvas drawer toggled by the header's hamburger
  // button — previously it was always rendered at full width even on a
  // 375px viewport, squeezing every page's content into a ~150px column.
  const [mobileNavOpen, setMobileNavOpen] = useState(false)

  return (
    <div className="flex h-screen overflow-hidden">
      {mobileNavOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
          onClick={() => setMobileNavOpen(false)}
          aria-hidden="true"
        />
      )}
      {/* Dark navy chrome (matches the WelcomeBanner/login hero and
          redrob.io's own dark sections) against the lighter content pane —
          gives the app a distinct, branded identity instead of blending
          into an all-white page. Fixed to the viewport: only <main> below
          scrolls, so the sidebar (and header) never move with page content. */}
      <nav
        className={`fixed inset-y-0 left-0 z-50 flex h-full w-56 shrink-0 flex-col overflow-y-auto bg-[#0b1220] p-4 text-slate-300 transition-transform duration-200 ease-in-out dark:bg-[#070c16] md:static md:translate-x-0 ${
          mobileNavOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="mb-4 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <img
              key={user?.id}
              src={logo}
              alt="Redrob HRMS"
              className="animate-logo-welcome h-8 w-8 rounded-md"
            />
            <span className="text-lg font-semibold text-white">Redrob HRMS</span>
          </div>
          <button
            type="button"
            aria-label="Close menu"
            className="rounded-md p-1 text-slate-300 hover:bg-white/10 hover:text-white md:hidden"
            onClick={() => setMobileNavOpen(false)}
          >
            <X className="size-5" />
          </button>
        </div>
        <ul className="flex flex-col gap-1">
          {MODULE_NAV.filter((item) =>
            !HEADER_ONLY_NAV_PATHS.has(item.path) &&
            ('roles' in item && item.roles ? (item.roles as readonly string[]).includes(user?.role ?? '') : true),
          ).map((item) => {
            const Icon = item.icon
            // Assets and Recruitment (ATS) link out to our separately-built
            // platforms instead of an in-app route — plain external link,
            // no NavLink active-state styling since it never "is active".
            if ('externalHref' in item && item.externalHref) {
              return (
                <li key={item.path}>
                  <a
                    href={item.externalHref}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-slate-300 transition-colors hover:bg-white/5 hover:text-white"
                  >
                    <Icon className={`size-4 shrink-0 ${item.color}`} />
                    {item.label}
                  </a>
                </li>
              )
            }
            return (
              <li key={item.path}>
                <NavLink
                  to={item.path}
                  onClick={() => setMobileNavOpen(false)}
                  className={({ isActive }) =>
                    `flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors ${
                      isActive
                        ? 'bg-white/10 text-white'
                        : 'text-slate-300 hover:bg-white/5 hover:text-white'
                    }`
                  }
                >
                  <Icon className={`size-4 shrink-0 ${item.color}`} />
                  {item.label}
                </NavLink>
              </li>
            )
          })}
        </ul>
      </nav>
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="flex shrink-0 items-center justify-between gap-1 border-b border-border bg-card px-4 py-2 shadow-sm md:justify-end">
          <button
            type="button"
            aria-label="Open menu"
            className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground md:hidden"
            onClick={() => setMobileNavOpen(true)}
          >
            <Menu className="size-5" />
          </button>
          <div className="flex items-center gap-1">
          <Link
            to="/notifications"
            aria-label="Notifications"
            className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <Bell className="size-5" />
          </Link>
          {/* This task: the icon no longer navigates directly — it opens a
              dropdown with My Dashboard/My Profile/Settings/Sign Out. Same
              /analytics, /my-profile, /settings routes and the same
              logout() as the sidebar's old "Sign out" button. */}
          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label="Profile menu"
              className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <User className="size-5" />
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <div className="px-2 py-1.5 text-sm">
                <p className="font-medium">{user?.name}</p>
                <p className="text-muted-foreground">{user?.role}</p>
              </div>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => navigate('/dashboard')}>
                <LayoutDashboard /> My Dashboard
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => navigate('/my-profile')}>
                <UserCircle /> My Profile
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => navigate('/settings')}>
                <Settings /> Settings
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setChangePasswordOpen(true)}>
                <KeyRound /> Change Password
              </DropdownMenuItem>
              <DropdownMenuItem onClick={logout}>
                <LogOut /> Sign Out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          </div>
        </header>
        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>
      <FloatingAssistant />
      <ChangePasswordDialog open={changePasswordOpen} onOpenChange={setChangePasswordOpen} />
    </div>
  )
}
