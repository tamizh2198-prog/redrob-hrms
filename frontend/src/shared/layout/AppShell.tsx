import type { ReactNode } from 'react'
import { Link, NavLink, useNavigate } from 'react-router-dom'
import { Bell, LayoutDashboard, LogOut, Settings, User, UserCircle } from 'lucide-react'
import { MODULE_NAV } from '@/app-routes'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useAuth } from '@/shared/auth/AuthContext'
import { AssistantBubble } from '@/modules/assistant'
import logo from '@/assets/logo.jpg'

// This task: Profile, Notifications, and Settings move from the sidebar
// into a top-right header/dropdown — same /my-profile, /notifications, and
// /settings routes, same MODULE_NAV entries (still rendered by
// app-routes.tsx), just no longer listed as sidebar links.
const HEADER_ONLY_NAV_PATHS = new Set(['/notifications', '/settings'])

export function AppShell({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth()
  const navigate = useNavigate()

  return (
    <div className="flex min-h-screen">
      {/* Dark navy chrome (matches the WelcomeBanner/login hero and
          redrob.io's own dark sections) against the lighter content pane —
          gives the app a distinct, branded identity instead of blending
          into an all-white page. */}
      <nav className="flex w-56 shrink-0 flex-col bg-[#0b1220] p-4 text-slate-300 dark:bg-[#070c16]">
        <div className="mb-4 flex items-center gap-2">
          <img
            key={user?.id}
            src={logo}
            alt="Redrob HRMS"
            className="animate-logo-welcome h-8 w-8 rounded-md"
          />
          <span className="text-lg font-semibold text-white">Redrob HRMS</span>
        </div>
        <ul className="flex flex-col gap-1">
          {MODULE_NAV.filter((item) =>
            !HEADER_ONLY_NAV_PATHS.has(item.path) &&
            ('roles' in item && item.roles ? (item.roles as readonly string[]).includes(user?.role ?? '') : true),
          ).map((item) => {
            const Icon = item.icon
            return (
              <li key={item.path}>
                <NavLink
                  to={item.path}
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
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-end gap-1 border-b border-border bg-card px-4 py-2 shadow-sm">
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
              <DropdownMenuItem onClick={logout}>
                <LogOut /> Sign Out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </header>
        <main className="flex-1">{children}</main>
      </div>
      <AssistantBubble />
    </div>
  )
}
