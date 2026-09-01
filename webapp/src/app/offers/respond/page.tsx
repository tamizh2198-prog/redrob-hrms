import { Suspense } from "react"
import { OfferResponsePage } from "@/modules/ats/pages/OfferResponsePage"

// Public route — deliberately outside the (app) route group so it never
// mounts the authenticated AppShell/Gate layout. Reached via a magic-link
// token from the offer-sent email, not a login. Wrapped in Suspense because
// OfferResponsePage reads useSearchParams(), which opts the page into
// client-side rendering unless a boundary is provided.
export default function Page() {
  return (
    <Suspense fallback={null}>
      <OfferResponsePage />
    </Suspense>
  )
}
