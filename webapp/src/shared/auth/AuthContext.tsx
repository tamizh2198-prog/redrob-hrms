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
  accessToken: string
  refreshToken: string
  // Only present on a response that just cleared an MFA challenge — lets
  // this same machine skip MFA on future logins. Absent when logging in
  // from an already-trusted device (nothing new to remember) or for a
  // role that never required MFA to begin with.
  deviceToken?: string
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
  loginWithPassword: (email: string, password: string) => Promise<LoginResponse>
  verifyMfa: (mfaToken: string, code: string) => Promise<void>
  confirmMfaEnrollment: (mfaToken: string, code: string) => Promise<void>
  logout: () => Promise<void>
  // The cached `user` here (and its localStorage mirror) is only ever set
  // at login — it never re-syncs on its own. Without this, editing your
  // own name via My Profile updates the database fine, but the header/
  // dashboard/profile menu keep showing whatever name was cached at your
  // last login until you log out and back in. Called by My Profile after
  // a successful save.
  updateUserName: (name: string) => void
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

// Deliberately NOT read as a useState lazy initializer — that function runs
// on the client's first render too (not just the server's), and `window`
// already exists by then, so reading localStorage there would return the
// real cached user while the server-rendered HTML has none: a hydration
// mismatch, not just a cosmetic flash. Only ever called from inside an
// effect (i.e. after hydration has already completed).
function readCachedUser(): AuthUser | null {
  const raw = localStorage.getItem('authUser')
  return raw ? (JSON.parse(raw) as AuthUser) : null
}

function persistSession(res: SessionResponse) {
  localStorage.setItem('accessToken', res.accessToken)
  localStorage.setItem('refreshToken', res.refreshToken)
  localStorage.setItem('authUser', JSON.stringify(res.user))
  if (res.deviceToken) {
    localStorage.setItem('deviceToken', res.deviceToken)
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  // Always starts null, matching the server-rendered HTML exactly — the
  // real cached session (if any) is synced in immediately after via the
  // effect below, once hydration has already completed.
  const [user, setUser] = useState<AuthUser | null>(null)

  useEffect(() => {
    // One-time hydration-safe sync of localStorage into React state — the
    // standard pattern for this (e.g. next-themes) intentionally triggers a
    // second render on mount, which is what these two rules are warning
    // about; there's no external-store subscription needed here since
    // login()/logout() already call setUser directly.
    setUser(readCachedUser())
  }, [])

  useEffect(() => {
    // Fired by lib/api.ts when a refresh-token round-trip fails (expired
    // or revoked) — the local session is already cleared by then, this
    // just syncs React state to match.
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
    const deviceToken = localStorage.getItem('deviceToken') ?? undefined
    const res = await api<LoginResponse>('/auth/login', {
      method: 'POST',
      body: { email, password, deviceToken },
    })
    if (res.status === 'OK') {
      persistSession(res)
      setUser(res.user)
    }
    return res
  }

  async function verifyMfa(mfaToken: string, code: string) {
    const res = await api<SessionResponse>('/auth/mfa/verify', {
      method: 'POST',
      body: { mfaToken, code },
    })
    persistSession(res)
    setUser(res.user)
  }

  async function confirmMfaEnrollment(mfaToken: string, code: string) {
    const res = await api<SessionResponse>('/auth/mfa/enroll/confirm', {
      method: 'POST',
      body: { mfaToken, code },
    })
    persistSession(res)
    setUser(res.user)
  }

  function updateUserName(name: string) {
    setUser((prev) => {
      if (!prev) return prev
      const next = { ...prev, name }
      localStorage.setItem('authUser', JSON.stringify(next))
      return next
    })
  }

  async function logout() {
    const refreshToken = localStorage.getItem('refreshToken')
    if (refreshToken) {
      try {
        await api('/auth/logout', { method: 'POST', body: { refreshToken } })
      } catch {
        // Best-effort — clear the local session regardless of whether the
        // server round-trip succeeded.
      }
    }
    localStorage.removeItem('accessToken')
    localStorage.removeItem('refreshToken')
    localStorage.removeItem('authUser')
    setUser(null)
  }

  return (
    <AuthContext.Provider
      value={{ user, loginWithPassword, verifyMfa, confirmMfaEnrollment, logout, updateUserName }}
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
