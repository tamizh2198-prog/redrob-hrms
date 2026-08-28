import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { forgotPassword } from '@/modules/employee/api'
import logo from '@/assets/logo.jpg'

// Interim self-service entry point (see backend EmployeeService.forgotPassword's
// comment) — mirrors ActivateAccountPage/ResetPasswordPage in staying outside
// the auth Gate, since the requester has no session at all. It never shows
// or emails a reset link itself; it just tells HR/Super Admin someone needs
// one, and always shows the same message regardless of whether the email
// matched a real account.
export function ForgotPasswordPage() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)

  async function handleSubmit() {
    setSubmitting(true)
    try {
      await forgotPassword(email)
    } finally {
      setSubmitting(false)
      setSubmitted(true)
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6">
      <img src={logo} alt="Redrob HRMS" className="h-16 w-16 rounded-xl" />
      <h1 className="text-2xl font-semibold">Forgot Password</h1>

      {!submitted ? (
        <div className="flex w-72 flex-col gap-3">
          <p className="text-center text-sm text-muted-foreground">
            Enter your work email. Our HR team will be notified and will reach out to reset
            your password.
          </p>

          <Label htmlFor="email">Work email</Label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            autoFocus
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@company.com"
          />

          <Button disabled={submitting || !email} onClick={handleSubmit}>
            {submitting ? 'Submitting…' : 'Submit'}
          </Button>
          <Button variant="ghost" onClick={() => navigate('/login')}>
            Back to Sign In
          </Button>
        </div>
      ) : (
        <div className="flex w-72 flex-col items-center gap-3 text-center">
          <p className="text-sm text-primary">
            If this email exists, our HR team has been notified and will reach out.
          </p>
          <Button onClick={() => navigate('/login')}>Back to Sign In</Button>
        </div>
      )}
    </div>
  )
}
