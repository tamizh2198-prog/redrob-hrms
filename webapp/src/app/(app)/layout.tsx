"use client"

import { useEffect, type ReactNode } from "react"
import { useRouter } from "next/navigation"
import { useAuth } from "@/shared/auth/AuthContext"
import { AppShell } from "@/shared/layout/AppShell"

// Mirrors the original frontend's Gate (App.tsx): every authenticated route
// lives under this group, guarded once here instead of per-page.
export default function AuthenticatedLayout({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const router = useRouter()

  useEffect(() => {
    if (!user) router.replace("/")
  }, [user, router])

  if (!user) return null

  return <AppShell>{children}</AppShell>
}
