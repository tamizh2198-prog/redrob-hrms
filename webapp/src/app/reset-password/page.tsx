import { Suspense } from "react"
import { ResetPasswordPage } from "@/shared/auth/ResetPasswordPage"

// Public route — deliberately outside the (app) route group so it never
// mounts the authenticated layout. Reached via a password-reset email link,
// not a login. Wrapped in Suspense because ResetPasswordPage reads
// useSearchParams(), which opts the page into client-side rendering unless
// a boundary is provided.
export default function Page() {
  return (
    <Suspense fallback={null}>
      <ResetPasswordPage />
    </Suspense>
  )
}
