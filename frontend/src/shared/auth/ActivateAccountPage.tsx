import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ApiError } from '@/lib/api'
import {
  validateActivationToken,
  activateAccount,
  type ActivationIdentity,
} from '@/modules/employee/api'
import logo from '@/assets/logo.jpg'

// Auth Phase 2: public activation page — no auth Gate wraps this route (see
// App.tsx). The invitation token itself is the authorization mechanism.
export function ActivateAccountPage() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const token = searchParams.get('token') ?? ''

  const [identity, setIdentity] = useState<ActivationIdentity | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [success, setSuccess] = useState(false)

  useEffect(() => {
    if (!token) {
      setLoadError('This activation link is missing a token.')
      return
    }
    validateActivationToken(token)
      .then(setIdentity)
      .catch((err) =>
        setLoadError(err instanceof ApiError ? err.message : 'This activation link is invalid.'),
      )
  }, [token])

  async function handleSubmit() {
    setSubmitError(null)
    setSubmitting(true)
    try {
      await activateAccount({ token, password, confirmPassword })
      setSuccess(true)
    } catch (err) {
      setSubmitError(err instanceof ApiError ? err.message : 'Failed to activate account')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6">
      <img src={logo} alt="Redrob HRMS" className="h-16 w-16 rounded-xl" />
      <h1 className="text-2xl font-semibold">Activate Your Account</h1>

      {loadError && <p className="max-w-sm text-center text-sm text-destructive">{loadError}</p>}

      {!loadError && !identity && <p className="text-sm text-muted-foreground">Loading…</p>}

      {identity && !success && (
        <div className="flex w-72 flex-col gap-3">
          <p className="text-center text-sm">
            Welcome, <strong>{identity.firstName} {identity.lastName}</strong> ({identity.employeeCode}).
            Set a password to activate your account.
          </p>

          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="At least 8 characters"
          />

          <Label htmlFor="confirmPassword">Confirm password</Label>
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
            {submitting ? 'Activating…' : 'Activate Account'}
          </Button>
        </div>
      )}

      {success && (
        <div className="flex w-72 flex-col items-center gap-3 text-center">
          <p className="text-sm text-primary">
            Your account is now active. You can sign in with your email and password.
          </p>
          <Button onClick={() => navigate('/login')}>Go to Login</Button>
        </div>
      )}
    </div>
  )
}
