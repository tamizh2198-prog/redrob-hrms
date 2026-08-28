import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Eye, EyeOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { useAuth, type LoginResponse } from './AuthContext'
import logo from '@/assets/logo.jpg'

type Screen =
  | { step: 'credentials' }
  | { step: 'mfaVerify'; mfaToken: string }
  | { step: 'mfaEnroll'; mfaToken: string; secret: string; qrCodeDataUrl: string }

export function LoginPage() {
  const { loginWithPassword, verifyMfa, confirmMfaEnrollment } = useAuth()
  const navigate = useNavigate()
  const [screen, setScreen] = useState<Screen>({ step: 'credentials' })
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  function handleLoginResult(res: LoginResponse) {
    if (res.status === 'MFA_REQUIRED') {
      setScreen({ step: 'mfaVerify', mfaToken: res.mfaToken })
      setCode('')
    } else if (res.status === 'MFA_ENROLL_REQUIRED') {
      setScreen({
        step: 'mfaEnroll',
        mfaToken: res.mfaToken,
        secret: res.secret,
        qrCodeDataUrl: res.qrCodeDataUrl,
      })
      setCode('')
    } else {
      navigate('/dashboard')
    }
  }

  async function handleCredentialsSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const res = await loginWithPassword(email, password)
      handleLoginResult(res)
    } catch (err) {
      setError(
        err instanceof Error && err.message
          ? err.message
          : 'Invalid email or password.',
      )
    } finally {
      setLoading(false)
    }
  }

  async function handleMfaVerifySubmit(e: FormEvent) {
    e.preventDefault()
    if (screen.step !== 'mfaVerify') return
    setError(null)
    setLoading(true)
    try {
      await verifyMfa(screen.mfaToken, code)
      navigate('/dashboard')
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : 'Verification failed.')
    } finally {
      setLoading(false)
    }
  }

  async function handleMfaEnrollSubmit(e: FormEvent) {
    e.preventDefault()
    if (screen.step !== 'mfaEnroll') return
    setError(null)
    setLoading(true)
    try {
      await confirmMfaEnrollment(screen.mfaToken, code)
      navigate('/dashboard')
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : 'Verification failed.')
    } finally {
      setLoading(false)
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
          <img src={logo} alt="Redrob HRMS" className="mb-2 h-12 w-12 rounded-xl" />
          <CardTitle className="text-lg font-semibold tracking-tight">Redrob HRMS</CardTitle>
          {screen.step === 'credentials' && (
            <>
              <h1 className="mt-3 text-xl font-semibold">Welcome back</h1>
              <CardDescription>Sign in to your account</CardDescription>
            </>
          )}
          {screen.step === 'mfaVerify' && (
            <>
              <h1 className="mt-3 text-xl font-semibold">Two-factor verification</h1>
              <CardDescription>
                Enter the 6-digit code from your authenticator app
              </CardDescription>
            </>
          )}
          {screen.step === 'mfaEnroll' && (
            <>
              <h1 className="mt-3 text-xl font-semibold">Set up two-factor authentication</h1>
              <CardDescription>Required for this role before you can sign in</CardDescription>
            </>
          )}
        </CardHeader>

        <CardContent>
          {screen.step === 'credentials' && (
            <form onSubmit={handleCredentialsSubmit} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  autoFocus
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@company.com"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="password">Password</Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="pr-9"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    className="absolute inset-y-0 right-0 flex w-9 items-center justify-center text-muted-foreground hover:text-foreground"
                  >
                    {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => navigate('/forgot-password')}
                  className="self-end text-xs text-muted-foreground underline-offset-4 hover:underline"
                >
                  Forgot password?
                </button>
              </div>

              {error && (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}

              <Button type="submit" className="mt-1 w-full" disabled={loading || !email || !password}>
                {loading ? 'Signing in…' : 'Sign In'}
              </Button>
            </form>
          )}

          {screen.step === 'mfaVerify' && (
            <form onSubmit={handleMfaVerifySubmit} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="mfa-code">6-digit code</Label>
                <Input
                  id="mfa-code"
                  autoFocus
                  inputMode="numeric"
                  maxLength={6}
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="123456"
                />
              </div>
              {error && (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}
              <Button type="submit" className="mt-1 w-full" disabled={loading || code.length < 6}>
                {loading ? 'Verifying…' : 'Verify'}
              </Button>
            </form>
          )}

          {screen.step === 'mfaEnroll' && (
            <form onSubmit={handleMfaEnrollSubmit} className="flex flex-col gap-4">
              <p className="text-sm text-muted-foreground">
                Scan this with an authenticator app (Google Authenticator, Authy,
                1Password, etc.), then enter the code it shows.
              </p>
              <img
                src={screen.qrCodeDataUrl}
                alt="MFA enrollment QR code"
                className="mx-auto h-48 w-48"
              />
              <p className="text-center text-xs text-muted-foreground">
                Can't scan? <span className="font-mono">{screen.secret}</span>
              </p>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="mfa-enroll-code">6-digit code</Label>
                <Input
                  id="mfa-enroll-code"
                  inputMode="numeric"
                  maxLength={6}
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="123456"
                />
              </div>
              {error && (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}
              <Button type="submit" className="mt-1 w-full" disabled={loading || code.length < 6}>
                {loading ? 'Confirming…' : 'Confirm and finish sign-in'}
              </Button>
            </form>
          )}

          <p className="mt-6 text-center text-xs text-muted-foreground">Secure employee access</p>
        </CardContent>
      </Card>
    </div>
  )
}
