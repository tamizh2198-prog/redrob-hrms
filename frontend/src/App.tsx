import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { AuthProvider, useAuth } from '@/shared/auth/AuthContext'
import { AppShell } from '@/shared/layout/AppShell'
import { LoginPage } from '@/shared/auth/LoginPage'
import { AppRoutes } from '@/app-routes'
import { CareersApplyPage, OfferResponsePage } from '@/modules/ats'
import { PreboardingPortalPage } from '@/modules/onboarding'

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
        {/* These candidate/new-hire routes are reached via emailed magic
            links, not employee login — they must stay outside the auth
            Gate below, which otherwise blocks every path with LoginPage. */}
        <Routes>
          <Route path="/careers/apply" element={<CareersApplyPage />} />
          <Route path="/offers/respond" element={<OfferResponsePage />} />
          <Route path="/preboard" element={<PreboardingPortalPage />} />
          <Route path="*" element={<Gate />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}

export default App
