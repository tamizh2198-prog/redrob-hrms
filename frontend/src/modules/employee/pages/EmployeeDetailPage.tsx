import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useAuth } from '@/shared/auth/AuthContext'
import { ApiError } from '@/lib/api'
import {
  getEmployee,
  getOrgChart,
  revealSensitiveFields,
  updateEmployee,
  type BloodGroup,
  type Employee,
  type OrgChartResponse,
} from '../api'

const BLOOD_GROUPS: BloodGroup[] = [
  'A_POSITIVE',
  'A_NEGATIVE',
  'B_POSITIVE',
  'B_NEGATIVE',
  'AB_POSITIVE',
  'AB_NEGATIVE',
  'O_POSITIVE',
  'O_NEGATIVE',
]

// Mirrors the backend's SELF_SERVICE_FIELDS (employee.types.ts) — these are
// "Step 2" fields the new hire completes themselves; submitting any of them
// as a non-HR user always creates a ProfileChangeRequest, never a direct
// write (Section 7.1 Business Rule).
const SELF_SERVICE_FIELDS = [
  'personalEmail',
  'workEmail',
  'phone',
  'pan',
  'aadhaar',
  'bankAccountNumber',
  'ifscCode',
  'bloodGroup',
  'emergencyContactName',
  'emergencyContactPhone',
] as const

export function EmployeeDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { user } = useAuth()
  const isHrAdmin = user?.role === 'HR_ADMIN' || user?.role === 'SUPER_ADMIN'
  const isSelf = user?.id === id

  const [employee, setEmployee] = useState<Employee | null>(null)
  const [orgChart, setOrgChart] = useState<OrgChartResponse | null>(null)
  const [revealed, setRevealed] = useState<{
    pan: string | null
    aadhaar: string | null
    bankAccountNumber: string | null
  } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [form, setForm] = useState<Partial<Employee>>({})

  useEffect(() => {
    if (!id) return
    setError(null)
    setRevealed(null)
    getEmployee(id)
      .then((e) => {
        setEmployee(e)
        setForm(e)
      })
      .catch((err) => {
        if (err instanceof ApiError && err.status === 403) {
          setError("You don't have permission to view this employee's full profile.")
        } else {
          setError(err instanceof Error ? err.message : 'Failed to load')
        }
      })
    getOrgChart(id)
      .then(setOrgChart)
      .catch(() => setOrgChart(null))
  }, [id])

  async function handleReveal() {
    if (!id) return
    try {
      setRevealed(await revealSensitiveFields(id))
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Not authorized to reveal these fields')
    }
  }

  async function handleSave() {
    if (!id) return
    setError(null)
    setMessage(null)
    try {
      const payload = isHrAdmin
        ? form
        : Object.fromEntries(
            SELF_SERVICE_FIELDS.map((f) => [f, form[f]]).filter(([, v]) => v !== undefined),
          )
      const res = await updateEmployee(id, payload)
      if ('changeRequestsCreated' in res) {
        setMessage(
          res.changeRequestsCreated > 0
            ? `Submitted ${res.changeRequestsCreated} change request(s) for HR Admin approval.`
            : 'No changes to submit.',
        )
      } else {
        setEmployee(res)
        setMessage('Saved.')
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to save')
    }
  }

  if (error && !employee) {
    return (
      <div className="flex flex-col gap-4 p-6">
        <Link to="/employee" className="text-sm text-muted-foreground underline-offset-4 hover:underline">
          ← Back to directory
        </Link>
        <p className="text-destructive">{error}</p>
      </div>
    )
  }
  if (!employee) {
    return <div className="p-6 text-muted-foreground">Loading…</div>
  }

  const canEdit = isHrAdmin || isSelf

  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <Link to="/employee" className="text-sm text-muted-foreground underline-offset-4 hover:underline">
          ← Back to directory
        </Link>
      </div>

      <div className="flex items-center gap-3">
        <h1 className="text-xl font-semibold">
          {employee.firstName} {employee.lastName}
        </h1>
        <Badge variant="outline">{employee.status}</Badge>
        <span className="text-sm text-muted-foreground">{employee.employeeCode}</span>
      </div>

      {message && <p className="text-sm text-primary">{message}</p>}
      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="grid grid-cols-2 gap-4">
        <Field label="Personal email" value={form.personalEmail} editable={canEdit}
          onChange={(v) => setForm((f) => ({ ...f, personalEmail: v }))} />
        <Field label="Work email" value={form.workEmail} editable={canEdit}
          onChange={(v) => setForm((f) => ({ ...f, workEmail: v }))} />
        <Field label="Phone" value={form.phone} editable={canEdit}
          onChange={(v) => setForm((f) => ({ ...f, phone: v }))} />
        <Field label="Emergency contact name" value={form.emergencyContactName} editable={canEdit}
          onChange={(v) => setForm((f) => ({ ...f, emergencyContactName: v }))} />
        <Field label="Emergency contact phone" value={form.emergencyContactPhone} editable={canEdit}
          onChange={(v) => setForm((f) => ({ ...f, emergencyContactPhone: v }))} />
      </div>

      {/* Section 7.1: PAN/Aadhaar/bank details are masked in the API response
          for anyone but a privileged viewer or the employee themselves — so
          whenever canEdit is true, `form`/`employee` already hold the real
          unmasked values and an editable input is enough. A Manager viewing
          a report's profile is neither, so they get the old read-only +
          Reveal flow instead. */}
      <div className="rounded-md border p-4">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="font-medium">Sensitive fields</h2>
          {!canEdit && (
            <Button variant="outline" size="sm" onClick={handleReveal}>
              Reveal
            </Button>
          )}
        </div>
        {canEdit ? (
          <div className="grid grid-cols-3 gap-4 text-sm">
            <Field label="PAN" value={form.pan} editable
              onChange={(v) => setForm((f) => ({ ...f, pan: v }))} />
            <Field label="Aadhaar" value={form.aadhaar} editable
              onChange={(v) => setForm((f) => ({ ...f, aadhaar: v }))} />
            <Field label="Bank account" value={form.bankAccountNumber} editable
              onChange={(v) => setForm((f) => ({ ...f, bankAccountNumber: v }))} />
            <Field label="IFSC code" value={form.ifscCode} editable
              onChange={(v) => setForm((f) => ({ ...f, ifscCode: v }))} />
            <div className="flex flex-col gap-1">
              <Label>Blood group</Label>
              <Select
                value={form.bloodGroup ?? ''}
                onValueChange={(v) => setForm((f) => ({ ...f, bloodGroup: v as BloodGroup }))}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select blood group">
                    {(v: string) => (v ? v.replaceAll('_', ' ') : 'Select blood group')}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {BLOOD_GROUPS.map((bg) => (
                    <SelectItem key={bg} value={bg}>
                      {bg.replaceAll('_', ' ')}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-4 text-sm">
            <div>
              <div className="text-muted-foreground">PAN</div>
              <div>{revealed?.pan ?? employee.pan}</div>
            </div>
            <div>
              <div className="text-muted-foreground">Aadhaar</div>
              <div>{revealed?.aadhaar ?? employee.aadhaar}</div>
            </div>
            <div>
              <div className="text-muted-foreground">Bank account</div>
              <div>{revealed?.bankAccountNumber ?? employee.bankAccountNumber}</div>
            </div>
            <div>
              <div className="text-muted-foreground">IFSC code</div>
              <div>{employee.ifscCode ?? '—'}</div>
            </div>
            <div>
              <div className="text-muted-foreground">Blood group</div>
              <div>{employee.bloodGroup?.replaceAll('_', ' ') ?? '—'}</div>
            </div>
          </div>
        )}
      </div>

      {canEdit && <Button onClick={handleSave}>{isHrAdmin ? 'Save' : 'Submit change request'}</Button>}

      {orgChart && (
        <div className="grid grid-cols-2 gap-6">
          <div>
            <h2 className="mb-2 font-medium">Reporting chain</h2>
            <ul className="flex flex-col gap-1 text-sm">
              {orgChart.managers.map((m) => (
                <li key={m.id}>
                  <Link to={`/employee/${m.id}`} className="underline-offset-4 hover:underline">
                    {m.firstName} {m.lastName}
                  </Link>
                </li>
              ))}
              {orgChart.managers.length === 0 && (
                <li className="text-muted-foreground">No manager</li>
              )}
            </ul>
          </div>
          <div>
            <h2 className="mb-2 font-medium">Direct reports</h2>
            <ul className="flex flex-col gap-1 text-sm">
              {orgChart.directReports.map((r) => (
                <li key={r.id}>
                  <Link to={`/employee/${r.id}`} className="underline-offset-4 hover:underline">
                    {r.firstName} {r.lastName}
                  </Link>
                </li>
              ))}
              {orgChart.directReports.length === 0 && (
                <li className="text-muted-foreground">None</li>
              )}
            </ul>
          </div>
        </div>
      )}
    </div>
  )
}

function Field({
  label,
  value,
  editable,
  onChange,
}: {
  label: string
  value?: string | null
  editable: boolean
  onChange: (value: string) => void
}) {
  return (
    <div className="flex flex-col gap-1">
      <Label>{label}</Label>
      <Input
        value={value ?? ''}
        disabled={!editable}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  )
}
