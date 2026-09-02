import { ForgotPasswordPage } from "@/shared/auth/ForgotPasswordPage"

// Public route — deliberately outside the (app) route group so it never
// mounts the authenticated layout. Linked from LoginPage's "Forgot
// password?" button. No query params read, so no Suspense boundary needed.
export default function Page() {
  return <ForgotPasswordPage />
}
