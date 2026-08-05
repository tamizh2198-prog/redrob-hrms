import { BrowserRouter } from 'react-router-dom'
import { AuthProvider, useAuth } from '@/shared/auth/AuthContext'
import { AppShell } from '@/shared/layout/AppShell'
import { LoginPage } from '@/shared/auth/LoginPage'
import { AppRoutes } from '@/app-routes'

function Gate() {
  const { user } = useAuth()
  if (!user) return <LoginPage />
  return (
    <AppShell>
      <AppRoutes />
    </AppShell>
  )
}

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Gate />
      </BrowserRouter>
    </AuthProvider>
  )
}

export default App
