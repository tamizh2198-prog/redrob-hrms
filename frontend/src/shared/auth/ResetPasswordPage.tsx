import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ApiError } from '@/lib/api'
import {
  validatePasswordResetToken,
  consumePasswordReset,
  type PasswordResetIdentity,
} from '@/modules/employee/api'
import logo from '@/assets/logo.jpg'

// Mirrors ActivateAccountPage — the reset token itself is the
// authorization mechanism, so this stays outside the auth Gate the same
// way account activation does (see App.tsx).
export function ResetPasswordPage() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
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
      .catch((err) =>
        setLoadError(err instanceof ApiError ? err.message : 'This reset link is invalid.'),
      )
  }, [token])

  async function handleSubmit() {
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
    <div className="flex min-h-screen flex-col items-center justify-center gap-6">
      <img src={logo} alt="Redrob HRMS" className="h-16 w-16 rounded-xl" />
      <h1 className="text-2xl font-semibold">Reset Your Password</h1>

      {loadError && <p className="max-w-sm text-center text-sm text-destructive">{loadError}</p>}

      {!loadError && !identity && <p className="text-sm text-muted-foreground">Loading…</p>}

      {identity && !success && (
        <div className="flex w-72 flex-col gap-3">
          <p className="text-center text-sm">
            Welcome back, <strong>{identity.firstName} {identity.lastName}</strong> ({identity.employeeCode}).
            Set a new password below. Every other device you were signed in on will be signed out.
          </p>

          <Label htmlFor="password">New password</Label>
          <Input
            id="password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="At least 8 characters"
          />

          <Label htmlFor="confirmPassword">Confirm new password</Label>
          <Input
            id="confirmPassword"
            type="password"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
          />

          {submitError && <p className="text-sm text-destructive">{submitError}</p>}

          <Button
            disabled={submitting || password.length < 8 || !confirmPassword}
            onClick={handleSubmit}
          >
            {submitting ? 'Resetting…' : 'Reset Password'}
          </Button>
        </div>
      )}

      {success && (
        <div className="flex w-72 flex-col items-center gap-3 text-center">
          <p className="text-sm text-primary">
            Your password has been reset. You can sign in with your new password now.
          </p>
          <Button onClick={() => navigate('/login')}>Go to Login</Button>
        </div>
      )}
    </div>
  )
}
