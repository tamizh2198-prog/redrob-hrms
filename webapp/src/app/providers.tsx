"use client"

import type { ReactNode } from "react"
import { ThemeProvider } from "@/shared/theme/ThemeContext"
import { AuthProvider } from "@/shared/auth/AuthContext"
import { ToastProvider } from "@/shared/notifications/ToastProvider"

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider>
      <AuthProvider>
        <ToastProvider>{children}</ToastProvider>
      </AuthProvider>
    </ThemeProvider>
  )
}
