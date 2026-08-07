import type { ReactNode } from 'react'
import { NavLink } from 'react-router-dom'
import { MODULE_NAV } from '@/app-routes'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/shared/auth/AuthContext'
import logo from '@/assets/logo.jpg'

export function AppShell({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth()

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
          {MODULE_NAV.map((item) => (
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
        <div className="mt-auto flex flex-col gap-1 border-t border-border pt-4 text-sm">
          <span className="text-muted-foreground">
            {user?.name} · {user?.role}
          </span>
          <Button variant="outline" size="sm" onClick={logout}>
            Sign out
          </Button>
        </div>
      </nav>
      <main className="flex-1">{children}</main>
    </div>
  )
}
