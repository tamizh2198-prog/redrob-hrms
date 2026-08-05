import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '@/shared/auth/AuthContext'
import type { Role } from '@/shared/auth/role'

interface RequireRoleProps {
  roles: Role[]
  children: ReactNode
}

export function RequireRole({ roles, children }: RequireRoleProps) {
  const { user } = useAuth()

  if (!user || !roles.includes(user.role)) {
    return <Navigate to="/" replace />
  }

  return <>{children}</>
}
