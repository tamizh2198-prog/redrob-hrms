"use client"

import { useEffect, type ReactNode } from "react"
import { useRouter } from "next/navigation"
import { useAuth } from "@/shared/auth/AuthContext"
import { AppShell } from "@/shared/layout/AppShell"

// Mirrors the original frontend's Gate (App.tsx): every authenticated route
// lives under this group, guarded once here instead of per-page.
export default function AuthenticatedLayout({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth()
  const router = useRouter()

  useEffect(() => {
    // Wait for the /auth/me check to resolve before redirecting — the
    // session lives in an httpOnly cookie now, so `user` starts null on
    // every mount even for a genuinely logged-in visitor.
    if (!loading && !user) router.replace("/")
  }, [loading, user, router])

  if (loading || !user) return null

  return <AppShell>{children}</AppShell>
}
