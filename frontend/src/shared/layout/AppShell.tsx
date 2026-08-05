import type { ReactNode } from 'react'
import { NavLink } from 'react-router-dom'
import { MODULE_NAV } from '@/app-routes'

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen">
      <nav className="w-56 shrink-0 border-r border-border p-4">
        <div className="mb-4 text-lg font-semibold">Redrob HRMS</div>
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
      </nav>
      <main className="flex-1">{children}</main>
    </div>
  )
}
