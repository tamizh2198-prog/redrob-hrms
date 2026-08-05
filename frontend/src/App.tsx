import { BrowserRouter } from 'react-router-dom'
import { AuthProvider } from '@/shared/auth/AuthContext'
import { AppShell } from '@/shared/layout/AppShell'
import { AppRoutes } from '@/app-routes'

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <AppShell>
          <AppRoutes />
        </AppShell>
      </BrowserRouter>
    </AuthProvider>
  )
}

export default App
