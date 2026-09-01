"use client"

import { useEffect, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/shared/auth/AuthContext'
import type { Role } from '@/shared/auth/role'

interface RequireRoleProps {
  roles: Role[]
  children: ReactNode
}

export function RequireRole({ roles, children }: RequireRoleProps) {
  const { user } = useAuth()
  const router = useRouter()
  const allowed = !!user && roles.includes(user.role)

  useEffect(() => {
    if (!allowed) router.replace('/')
  }, [allowed, router])

  if (!allowed) return null

  return <>{children}</>
}
