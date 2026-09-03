"use client"

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'
import { api } from '@/lib/api'
import type { Role } from './role'

export interface AuthUser {
  id: string
  name: string
  role: Role
}

interface SessionResponse {
  status: 'OK'
  user: AuthUser
}

export type LoginResponse =
  | SessionResponse
  | { status: 'MFA_REQUIRED'; mfaToken: string }
  | {
      status: 'MFA_ENROLL_REQUIRED'
      mfaToken: string
      secret: string
      qrCodeDataUrl: string
    }

interface AuthContextValue {
  user: AuthUser | null
  // True until the initial /auth/me check (see below) resolves. The session
  // now lives in an httpOnly cookie this code can't read directly, so "am I
  // logged in" is an async question — callers that redirect on `!user` must
  // also wait for `loading` to go false, or they'll bounce a genuinely
  // logged-in user before the check has had a chance to come back.
  loading: boolean
  loginWithPassword: (email: string, password: string) => Promise<LoginResponse>
  verifyMfa: (mfaToken: string, code: string) => Promise<void>
  confirmMfaEnrollment: (mfaToken: string, code: string) => Promise<void>
  logout: () => Promise<void>
  updateUserName: (name: string) => void
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // The only way to learn "am I logged in" now that tokens are httpOnly
    // cookies — replaces the old synchronous localStorage read. A 401 here
    // just means "not logged in," not an error.
    let cancelled = false
    api<AuthUser>('/auth/me')
      .then((u) => { if (!cancelled) setUser(u) })
      .catch(() => { if (!cancelled) setUser(null) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    // Fired by lib/api.ts when a refresh-token round-trip fails (expired
    // or revoked) — the cookies are already cleared server-side by then,
    // this just syncs React state to match.
    function handleForcedLogout() {
      setUser(null)
    }
    window.addEventListener('auth:logout', handleForcedLogout)
    return () => window.removeEventListener('auth:logout', handleForcedLogout)
  }, [])

  // Auth Phase 1: real email+password login. Section 11: Super Admin/HR
  // Admin don't get a session back directly — the caller (LoginPage) has
  // to branch on `status` and walk through MFA verify/enroll first.
  async function loginWithPassword(email: string, password: string) {
    const res = await api<LoginResponse>('/auth/login', {
      method: 'POST',
      body: { email, password },
    })
    if (res.status === 'OK') {
      setUser(res.user)
    }
    return res
  }

  async function verifyMfa(mfaToken: string, code: string) {
    const res = await api<SessionResponse>('/auth/mfa/verify', {
      method: 'POST',
      body: { mfaToken, code },
    })
    setUser(res.user)
  }

  async function confirmMfaEnrollment(mfaToken: string, code: string) {
    const res = await api<SessionResponse>('/auth/mfa/enroll/confirm', {
      method: 'POST',
      body: { mfaToken, code },
    })
    setUser(res.user)
  }

  function updateUserName(name: string) {
    setUser((prev) => (prev ? { ...prev, name } : prev))
  }

  async function logout() {
    try {
      await api('/auth/logout', { method: 'POST' })
    } catch {
      // Best-effort — clear the local session regardless of whether the
      // server round-trip succeeded.
    }
    setUser(null)
  }

  return (
    <AuthContext.Provider
      value={{ user, loading, loginWithPassword, verifyMfa, confirmMfaEnrollment, logout, updateUserName }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return ctx
}
