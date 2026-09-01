import { Suspense } from "react"
import { CareersApplyPage } from "@/modules/ats/pages/CareersApplyPage"

// Public route — deliberately outside the (app) route group so it never
// mounts the authenticated AppShell/Gate layout. Reached via a job posting
// link with ?requisitionId=, not a login. Wrapped in Suspense because
// CareersApplyPage reads useSearchParams(), which opts the page into
// client-side rendering unless a boundary is provided.
export default function Page() {
  return (
    <Suspense fallback={null}>
      <CareersApplyPage />
    </Suspense>
  )
}
