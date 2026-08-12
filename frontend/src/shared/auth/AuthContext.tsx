import {
  createContext,
  useContext,
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

interface LoginResponse {
  accessToken: string
  user: AuthUser
}

interface AuthContextValue {
  user: AuthUser | null
  loginWithPassword: (email: string, password: string) => Promise<void>
  logout: () => void
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

function restoreUser(): AuthUser | null {
  const raw = localStorage.getItem('authUser')
  return raw ? (JSON.parse(raw) as AuthUser) : null
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(restoreUser)

  // Auth Phase 1: real email+password login — reuses the same
  // token/response shape as dev-login so no other frontend code needs to
  // change.
  async function loginWithPassword(email: string, password: string) {
    const res = await api<LoginResponse>('/auth/login', {
      method: 'POST',
      body: { email, password },
    })
    persistSession(res)
  }

  function persistSession(res: LoginResponse) {
    localStorage.setItem('accessToken', res.accessToken)
    localStorage.setItem('authUser', JSON.stringify(res.user))
    setUser(res.user)
  }

  function logout() {
    localStorage.removeItem('accessToken')
    localStorage.removeItem('authUser')
    setUser(null)
  }

  return (
    <AuthContext.Provider value={{ user, loginWithPassword, logout }}>
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
