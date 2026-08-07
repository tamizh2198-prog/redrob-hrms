import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAuth } from './AuthContext'
import logo from '@/assets/logo.jpg'

const DEMO_USERS = [
  { code: 'EMP-SEED-0001', label: 'Aditi Rao — Super Admin' },
  { code: 'EMP-SEED-0002', label: 'Priya Sharma — HR Admin' },
  { code: 'EMP-SEED-0003', label: 'Karan Mehta — Manager' },
  { code: 'EMP-SEED-0004', label: 'Rahul Verma — Employee' },
]

export function LoginPage() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const [employeeCode, setEmployeeCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleLogin(code: string) {
    setError(null)
    setLoading(true)
    try {
      await login(code)
      navigate('/employee')
    } catch {
      setError(
        `No employee found with code "${code}". Run "npm run prisma:seed" in backend/ to create the demo users.`,
      )
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6">
      <img src={logo} alt="Redrob HRMS" className="h-16 w-16 rounded-xl" />
      <h1 className="text-2xl font-semibold">Redrob HRMS — Sign in</h1>

      <div className="flex flex-col gap-2">
        {DEMO_USERS.map((demo) => (
          <Button
            key={demo.code}
            variant="outline"
            disabled={loading}
            onClick={() => handleLogin(demo.code)}
          >
            {demo.label}
          </Button>
        ))}
      </div>

      <div className="flex w-64 flex-col gap-2">
        <Label htmlFor="employeeCode">Or sign in with an employee code</Label>
        <Input
          id="employeeCode"
          value={employeeCode}
          onChange={(e) => setEmployeeCode(e.target.value)}
          placeholder="EMP-2026-0001"
        />
        <Button
          disabled={loading || !employeeCode}
          onClick={() => handleLogin(employeeCode)}
        >
          Sign in
        </Button>
      </div>

      {error && <p className="max-w-sm text-center text-sm text-destructive">{error}</p>}
    </div>
  )
}
