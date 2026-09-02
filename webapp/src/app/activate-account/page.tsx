import { Suspense } from "react"
import { ActivateAccountPage } from "@/shared/auth/ActivateAccountPage"

// Public route — deliberately outside the (app) route group so it never
// mounts the authenticated layout. Reached via the invitation email's
// activation link, not a login. Wrapped in Suspense because
// ActivateAccountPage reads useSearchParams(), which opts the page into
// client-side rendering unless a boundary is provided.
export default function Page() {
  return (
    <Suspense fallback={null}>
      <ActivateAccountPage />
    </Suspense>
  )
}
