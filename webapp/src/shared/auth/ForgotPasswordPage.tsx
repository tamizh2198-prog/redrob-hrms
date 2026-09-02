"use client"

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { forgotPassword } from './api'

// Interim self-service entry point (see employeeService.forgotPassword's own
// comment) — mirrors ActivateAccountPage/ResetPasswordPage in staying
// outside the auth guard, since the requester has no session at all. It
// never shows or emails a reset link itself; it just tells HR/Super Admin
// someone needs one, and always shows the same message regardless of
// whether the email matched a real account.
export function ForgotPasswordPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)

  async function handleSubmit() {
    if (submitting) return
    setSubmitting(true)
    try {
      await forgotPassword(email)
    } finally {
      setSubmitting(false)
      setSubmitted(true)
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-gradient-to-br from-[#0b1220] via-[#122a52] to-[#2563eb] px-4">
      <span
        aria-hidden="true"
        className="animate-welcome-glow-a absolute -left-20 top-0 size-80 rounded-full bg-blue-400/25 blur-3xl"
      />
      <span
        aria-hidden="true"
        className="animate-welcome-glow-b absolute bottom-0 right-0 size-96 rounded-full bg-indigo-400/20 blur-3xl"
      />
      <Card className="relative w-full max-w-sm shadow-2xl">
        <CardHeader className="items-center text-center">
          <img src="/logo.jpg" alt="Redrob HRMS" className="mb-2 h-12 w-12 rounded-xl" />
          <CardTitle className="text-lg font-semibold tracking-tight">Redrob HRMS</CardTitle>
          <h1 className="mt-3 text-xl font-semibold">Forgot Password</h1>
          {!submitted && (
            <CardDescription>
              Enter your work email. Our HR team will be notified and will reach out to reset your password.
            </CardDescription>
          )}
        </CardHeader>

        <CardContent>
          {!submitted ? (
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
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
              </div>

              <Button className="w-full" disabled={submitting || !email} onClick={handleSubmit}>
                {submitting ? 'Submitting…' : 'Submit'}
              </Button>
              <Button variant="ghost" className="w-full" onClick={() => router.push('/')}>
                Back to Sign In
              </Button>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3 text-center">
              <p className="text-sm text-primary">
                If this email exists, our HR team has been notified and will reach out.
              </p>
              <Button className="w-full" onClick={() => router.push('/')}>
                Back to Sign In
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
