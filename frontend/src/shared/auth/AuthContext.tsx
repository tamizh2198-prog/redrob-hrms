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
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

function restoreUser(): AuthUser | null {
  const raw = localStorage.getItem('authUser')
  return raw ? (JSON.parse(raw) as AuthUser) : null
}

function persistSession(res: SessionResponse) {
  localStorage.setItem('accessToken', res.accessToken)
  localStorage.setItem('refreshToken', res.refreshToken)
  localStorage.setItem('authUser', JSON.stringify(res.user))
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(restoreUser)

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
    const res = await api<LoginResponse>('/auth/login', {
      method: 'POST',
      body: { email, password },
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
      value={{ user, loginWithPassword, verifyMfa, confirmMfaEnrollment, logout }}
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
