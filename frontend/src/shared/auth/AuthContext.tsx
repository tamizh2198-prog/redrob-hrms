import { createContext, useContext, useState, type ReactNode } from 'react'
import type { Role } from './role'

export interface AuthUser {
  id: string
  name: string
  role: Role
}

interface AuthContextValue {
  user: AuthUser | null
  setUser: (user: AuthUser | null) => void
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  // TODO: replace with real session state once the Auth module (Section 10,
  // OIDC/JWT) is wired up; every module reads the current user through here.
  const [user, setUser] = useState<AuthUser | null>(null)

  return (
    <AuthContext.Provider value={{ user, setUser }}>
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
