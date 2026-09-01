"use client"

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'

export type Theme = 'light' | 'dark'

const STORAGE_KEY = 'theme'

interface ThemeContextValue {
  theme: Theme
  setTheme: (theme: Theme) => void
  toggleTheme: () => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

// Deliberately NOT read as a useState lazy initializer — see AuthContext's
// readCachedUser() for why: that function also runs on the client's first
// (pre-hydration) render, where localStorage/matchMedia already resolve to
// their real values while the server-rendered HTML assumed 'light' —
// a hydration mismatch for anything that branches on `theme` during
// render, not just a cosmetic flash. Only ever called from inside an effect.
function readStoredTheme(): Theme {
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored === 'light' || stored === 'dark') return stored
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

// Every user gets this, not just admins — a personal display preference,
// not a company setting, so it lives in localStorage rather than the
// backend. Applies globally by toggling the `.dark` class already defined
// in globals.css (previously unused — no toggle existed before this).
export function ThemeProvider({ children }: { children: ReactNode }) {
  // Always starts 'light', matching the server-rendered HTML exactly — the
  // real stored/preferred theme is synced in immediately after via the
  // effect below, once hydration has already completed.
  const [theme, setTheme] = useState<Theme>('light')

  useEffect(() => {
    // One-time hydration-safe sync, same rationale as AuthContext's
    // readCachedUser() effect.
    setTheme(readStoredTheme())
  }, [])

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
    localStorage.setItem(STORAGE_KEY, theme)
  }, [theme])

  function toggleTheme() {
    setTheme((t) => (t === 'dark' ? 'light' : 'dark'))
  }

  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within a ThemeProvider')
  return ctx
}
