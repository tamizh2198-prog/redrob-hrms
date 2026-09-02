"use client"

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { ApiError } from '@/lib/api'
import { validatePasswordResetToken, consumePasswordReset, type PasswordResetIdentity } from './api'

// Mirrors ActivateAccountPage — the reset token itself is the authorization
// mechanism, so this stays outside the auth guard the same way account
// activation does (see webapp/src/app/reset-password/page.tsx).
export function ResetPasswordPage() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const token = searchParams.get('token') ?? ''

  const [identity, setIdentity] = useState<PasswordResetIdentity | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [success, setSuccess] = useState(false)

  useEffect(() => {
    if (!token) {
      setLoadError('This password reset link is missing a token.')
      return
    }
    validatePasswordResetToken(token)
      .then(setIdentity)
      .catch((err) => setLoadError(err instanceof ApiError ? err.message : 'This reset link is invalid.'))
  }, [token])

  async function handleSubmit() {
    if (submitting) return
    setSubmitError(null)
    setSubmitting(true)
    try {
      await consumePasswordReset({ token, password, confirmPassword })
      setSuccess(true)
    } catch (err) {
      setSubmitError(err instanceof ApiError ? err.message : 'Failed to reset password')
    } finally {
      setSubmitting(false)
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
          <h1 className="mt-3 text-xl font-semibold">Reset Your Password</h1>
          <CardDescription>Set a new password for your account</CardDescription>
        </CardHeader>

        <CardContent>
          {loadError && <p className="text-center text-sm text-destructive">{loadError}</p>}

          {!loadError && !identity && <p className="text-center text-sm text-muted-foreground">Loading…</p>}

          {identity && !success && (
            <div className="flex flex-col gap-4">
              <p className="text-center text-sm">
                Welcome back, <strong>{identity.firstName} {identity.lastName}</strong> ({identity.employeeCode}).
                Every other device you were signed in on will be signed out.
              </p>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="password">New password</Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="new-password"
                  autoFocus
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="At least 8 characters"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="confirmPassword">Confirm new password</Label>
                <Input
                  id="confirmPassword"
                  type="password"
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                />
              </div>

              {submitError && (
                <p role="alert" className="text-sm text-destructive">
                  {submitError}
                </p>
              )}

              <Button
                className="w-full"
                disabled={submitting || password.length < 8 || !confirmPassword}
                onClick={handleSubmit}
              >
                {submitting ? 'Resetting…' : 'Reset Password'}
              </Button>
            </div>
          )}

          {success && (
            <div className="flex flex-col items-center gap-3 text-center">
              <p className="text-sm text-primary">
                Your password has been reset. You can sign in with your new password now.
              </p>
              <Button className="w-full" onClick={() => router.push('/')}>
                Go to Login
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
