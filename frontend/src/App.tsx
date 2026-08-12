import { useEffect, useState } from 'react'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { AuthProvider, useAuth } from '@/shared/auth/AuthContext'
import { AppShell } from '@/shared/layout/AppShell'
import { LoginPage } from '@/shared/auth/LoginPage'
import { ActivateAccountPage } from '@/shared/auth/ActivateAccountPage'
import { AppRoutes } from '@/app-routes'
import { CareersApplyPage, OfferResponsePage } from '@/modules/ats'
import { PreboardingPortalPage } from '@/modules/onboarding'
import { ProfileCompletionPage } from '@/modules/employee'
import { getMyProfile } from '@/modules/employee/api'

// Auth Phase 3: HR_ADMIN/SUPER_ADMIN must never be redirected to profile
// completion, regardless of what their own record's completion percentage
// happens to be — only regular staff (EMPLOYEE/MANAGER) are gated.
function isExemptFromProfileGate(role: string | undefined) {
  return role === 'HR_ADMIN' || role === 'SUPER_ADMIN'
}

function Gate() {
  const { user } = useAuth()
  const [checkingProfile, setCheckingProfile] = useState(true)
  const [profileIncomplete, setProfileIncomplete] = useState(false)

  useEffect(() => {
    if (!user || isExemptFromProfileGate(user.role)) {
      setCheckingProfile(false)
      return
    }
    getMyProfile()
      .then((res) => setProfileIncomplete(!res.isComplete))
      .catch(() => setProfileIncomplete(false))
      .finally(() => setCheckingProfile(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id])

  if (!user) return <LoginPage />
  if (checkingProfile) return null
  if (profileIncomplete) return <ProfileCompletionPage />

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
          {/* Auth Phase 2: employee has no account/JWT yet at this point,
              so activation must also stay outside the Gate. */}
          <Route path="/activate-account" element={<ActivateAccountPage />} />
          <Route path="*" element={<Gate />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}

export default App
