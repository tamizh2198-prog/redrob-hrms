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
import logo from '@/assets/logo.jpg'

// This task: Profile and Notifications move from the sidebar into a
// top-right header — same /my-profile and /notifications routes, same
// MODULE_NAV entries (still rendered by app-routes.tsx), just no longer
// listed as sidebar links.
const HEADER_ONLY_NAV_PATHS = new Set(['/notifications'])

export function AppShell({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth()
  const navigate = useNavigate()

  return (
    <div className="flex min-h-screen">
      <nav className="flex w-56 shrink-0 flex-col border-r border-border p-4">
        <div className="mb-4 flex items-center gap-2">
          <img
            key={user?.id}
            src={logo}
            alt="Redrob HRMS"
            className="animate-logo-welcome h-8 w-8 rounded-md"
          />
          <span className="text-lg font-semibold">Redrob HRMS</span>
        </div>
        <ul className="flex flex-col gap-1">
          {MODULE_NAV.filter((item) =>
            !HEADER_ONLY_NAV_PATHS.has(item.path) &&
            ('roles' in item && item.roles ? (item.roles as readonly string[]).includes(user?.role ?? '') : true),
          ).map((item) => (
            <li key={item.path}>
              <NavLink
                to={item.path}
                className={({ isActive }) =>
                  `block rounded-md px-2 py-1.5 text-sm ${
                    isActive
                      ? 'bg-secondary text-secondary-foreground'
                      : 'text-muted-foreground hover:bg-muted'
                  }`
                }
              >
                {item.label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-end gap-1 border-b border-border px-4 py-2">
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
              <DropdownMenuItem onClick={() => navigate('/analytics')}>
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
    </div>
  )
}
