"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { useAuth } from "@/shared/auth/AuthContext"
import { LoginPage } from "@/shared/auth/LoginPage"
import { getMyProfile } from "@/modules/employee/api"

// Auth Phase 3: HR_ADMIN/SUPER_ADMIN must never be redirected to profile
// completion, regardless of what their own record's completion percentage
// happens to be — only regular staff (EMPLOYEE/MANAGER) are gated.
function isExemptFromProfileGate(role: string | undefined) {
  return role === "HR_ADMIN" || role === "SUPER_ADMIN"
}

// Mirrors the original frontend's Gate (App.tsx) for the "/" route
// specifically: unauthenticated -> LoginPage, authenticated -> redirect to
// /my-profile (incomplete) or /employee (complete).
export default function RootPage() {
  const { user, loading } = useAuth()
  const router = useRouter()
  const [checking, setChecking] = useState(true)

  useEffect(() => {
    // The session lives in an httpOnly cookie now — `loading` is true until
    // the initial /auth/me check comes back, so `!user` isn't trustworthy
    // as "logged out" until then.
    if (loading) return
    if (!user) {
      setChecking(false)
      return
    }
    if (isExemptFromProfileGate(user.role)) {
      router.replace("/employee")
      return
    }
    getMyProfile()
      .then((res) => router.replace(res.isComplete ? "/employee" : "/my-profile"))
      .catch(() => router.replace("/employee"))
  }, [loading, user, router])

  if (loading) return null
  if (user) return null
  if (checking) return null
  return <LoginPage />
}
