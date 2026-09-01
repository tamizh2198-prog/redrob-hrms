import { Suspense } from "react"
import { PreboardingPortalPage } from "@/modules/onboarding/pages/PreboardingPortalPage"

// Public route — deliberately outside the (app) route group so it never
// mounts the authenticated AppShell/Gate layout. Reached via a magic-link
// token from the offer-accept email, not a login. Wrapped in Suspense
// because PreboardingPortalPage reads useSearchParams(), which opts the
// page into client-side rendering unless a boundary is provided.
export default function Page() {
  return (
    <Suspense fallback={null}>
      <PreboardingPortalPage />
    </Suspense>
  )
}
