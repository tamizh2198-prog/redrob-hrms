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

interface DevLoginResponse {
  accessToken: string
  user: AuthUser
}

interface AuthContextValue {
  user: AuthUser | null
  login: (employeeCode: string) => Promise<void>
  logout: () => void
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

function restoreUser(): AuthUser | null {
  const raw = localStorage.getItem('authUser')
  return raw ? (JSON.parse(raw) as AuthUser) : null
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(restoreUser)

  async function login(employeeCode: string) {
    const res = await api<DevLoginResponse>('/auth/dev-login', {
      method: 'POST',
      body: { employeeCode },
    })
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
    <AuthContext.Provider value={{ user, login, logout }}>
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
