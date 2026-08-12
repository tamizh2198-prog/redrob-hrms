import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ApiError } from '@/lib/api'
import {
  getMyProfile,
  updateMyProfile,
  getReferenceData,
  type MyProfileResponse,
  type UpdateMyProfileInput,
  type ReferenceData,
  type Gender,
} from '../api'

const GENDERS: Gender[] = ['MALE', 'FEMALE', 'OTHER', 'PREFER_NOT_TO_SAY']

function toDateInputValue(value: string | null): string {
  return value ? value.slice(0, 10) : ''
}

export function ProfileCompletionPage() {
  const [profile, setProfile] = useState<MyProfileResponse | null>(null)
  const [reference, setReference] = useState<ReferenceData | null>(null)
  const [form, setForm] = useState<UpdateMyProfileInput>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  function refresh() {
    setLoading(true)
    getMyProfile()
      .then((res) => {
        setProfile(res)
        const e = res.employee
        setForm({
          dob: toDateInputValue(e.dob),
          gender: e.gender ?? undefined,
          phone: e.phone ?? '',
          personalEmail: e.personalEmail ?? '',
          addressLine: e.addressLine ?? '',
          city: e.city ?? '',
          state: e.state ?? '',
          country: e.country ?? '',
          postalCode: e.postalCode ?? '',
          pan: e.pan ?? '',
          aadhaar: e.aadhaar ?? '',
          bankAccountNumber: e.bankAccountNumber ?? '',
          emergencyContactName: e.emergencyContactName ?? '',
          emergencyContactPhone: e.emergencyContactPhone ?? '',
        })
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load profile'))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    refresh()
    getReferenceData().then(setReference).catch(() => setReference(null))
     
  }, [])

  function update<K extends keyof UpdateMyProfileInput>(key: K, value: UpdateMyProfileInput[K]) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  async function handleSave(continueOnComplete: boolean) {
    setSaving(true)
    setError(null)
    setMessage(null)
    try {
      // Empty strings mean "not filled in yet", not "clear this field" —
      // send them as omitted so @IsOptional() validators on the backend
      // don't reject an unfilled optional field (e.g. personal email).
      const payload = Object.fromEntries(
        Object.entries(form).filter(([, value]) => value !== ''),
      ) as UpdateMyProfileInput
      const result = await updateMyProfile(payload)
      setProfile(result)
      if (continueOnComplete && result.isComplete) {
        // Full reload so the App-level Gate re-checks completion with
        // fresh data and stops blocking on the profile-completion screen.
        window.location.href = '/employee'
        return
      }
      setMessage(
        result.isComplete
          ? 'Profile saved. All required information is complete.'
          : 'Progress saved. You can continue later.',
      )
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to save profile')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <div className="p-6 text-sm text-muted-foreground">Loading…</div>
  }

  if (!profile) {
    return <div className="p-6 text-sm text-destructive">{error ?? 'Failed to load profile'}</div>
  }

  const { employee, completionPercentage, isComplete, missingFields } = profile
  const isRequired = (label: string) => profile.requiredFields.includes(label)

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 p-6">
      <div>
        <h1 className="text-xl font-semibold">
          {isComplete ? 'My Profile' : 'Complete Your Profile'}
        </h1>
        <p className="text-sm text-muted-foreground">
          {isComplete
            ? 'Update your personal, address, and payroll information below.'
            : 'Please complete the required information before continuing.'}
        </p>
      </div>

      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between text-sm">
          <span className="font-medium">Profile Completion</span>
          <span>{completionPercentage}%</span>
        </div>
        <div className="h-2 w-full rounded-full bg-muted">
          <div
            className="h-2 rounded-full bg-primary transition-all"
            style={{ width: `${completionPercentage}%` }}
          />
        </div>
        {!isComplete && missingFields.length > 0 && (
          <p className="mt-1 text-xs text-muted-foreground">Missing: {missingFields.join(', ')}</p>
        )}
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}
      {message && <p className="text-sm text-primary">{message}</p>}

      <section className="flex flex-col gap-3 rounded-md border p-4">
        <h2 className="font-medium">Personal Information</h2>
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1">
            <Label>First name</Label>
            <Input value={employee.firstName} disabled />
          </div>
          <div className="flex flex-col gap-1">
            <Label>Last name</Label>
            <Input value={employee.lastName} disabled />
          </div>
          <div className="flex flex-col gap-1">
            <Label>Date of birth {isRequired('Date of Birth') && '*'}</Label>
            <Input type="date" value={form.dob ?? ''} onChange={(e) => update('dob', e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <Label>Gender {isRequired('Gender') && '*'}</Label>
            <Select value={form.gender ?? ''} onValueChange={(v) => update('gender', v as Gender)}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select gender">
                  {(v: string) => v.replaceAll('_', ' ') || 'Select gender'}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {GENDERS.map((g) => (
                  <SelectItem key={g} value={g}>
                    {g.replaceAll('_', ' ')}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <Label>Phone {isRequired('Phone Number') && '*'}</Label>
            <Input value={form.phone ?? ''} onChange={(e) => update('phone', e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <Label>Personal email</Label>
            <Input
              type="email"
              value={form.personalEmail ?? ''}
              onChange={(e) => update('personalEmail', e.target.value)}
            />
          </div>
        </div>
      </section>

      <section className="flex flex-col gap-3 rounded-md border p-4">
        <h2 className="font-medium">Address</h2>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2 flex flex-col gap-1">
            <Label>Address {isRequired('Address') && '*'}</Label>
            <Input value={form.addressLine ?? ''} onChange={(e) => update('addressLine', e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <Label>City {isRequired('City') && '*'}</Label>
            <Input value={form.city ?? ''} onChange={(e) => update('city', e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <Label>State {isRequired('State') && '*'}</Label>
            <Input value={form.state ?? ''} onChange={(e) => update('state', e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <Label>Country</Label>
            <Input value={form.country ?? ''} onChange={(e) => update('country', e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <Label>Postal code {isRequired('Postal Code') && '*'}</Label>
            <Input value={form.postalCode ?? ''} onChange={(e) => update('postalCode', e.target.value)} />
          </div>
        </div>
      </section>

      <section className="flex flex-col gap-3 rounded-md border p-4">
        <h2 className="font-medium">Employment Information</h2>
        <p className="text-xs text-muted-foreground">Read-only — contact HR to change these.</p>
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1">
            <Label>Employee code</Label>
            <Input value={employee.employeeCode} disabled />
          </div>
          <div className="flex flex-col gap-1">
            <Label>Role</Label>
            <Input value={employee.role} disabled />
          </div>
          <div className="flex flex-col gap-1">
            <Label>Status</Label>
            <Input value={employee.status} disabled />
          </div>
          <div className="flex flex-col gap-1">
            <Label>Department</Label>
            <Input
              value={reference?.departments.find((d) => d.id === employee.departmentId)?.name ?? '—'}
              disabled
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label>Location</Label>
            <Input
              value={reference?.locations.find((l) => l.id === employee.locationId)?.name ?? '—'}
              disabled
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label>Reporting manager</Label>
            <Input
              value={
                (() => {
                  const m = reference?.managers.find((mgr) => mgr.id === employee.reportingManagerId)
                  return m ? `${m.firstName} ${m.lastName}` : '—'
                })()
              }
              disabled
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label>Date of joining</Label>
            <Input value={toDateInputValue(employee.dateOfJoining)} disabled />
          </div>
        </div>
      </section>

      <section className="flex flex-col gap-3 rounded-md border p-4">
        <h2 className="font-medium">Bank / Payroll Information</h2>
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1">
            <Label>PAN {isRequired('PAN') && '*'}</Label>
            <Input value={form.pan ?? ''} onChange={(e) => update('pan', e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <Label>Aadhaar</Label>
            <Input value={form.aadhaar ?? ''} onChange={(e) => update('aadhaar', e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <Label>Bank account number {isRequired('Bank Account Number') && '*'}</Label>
            <Input
              value={form.bankAccountNumber ?? ''}
              onChange={(e) => update('bankAccountNumber', e.target.value)}
            />
          </div>
        </div>
      </section>

      <section className="flex flex-col gap-3 rounded-md border p-4">
        <h2 className="font-medium">Emergency Contact</h2>
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1">
            <Label>Name {isRequired('Emergency Contact Name') && '*'}</Label>
            <Input
              value={form.emergencyContactName ?? ''}
              onChange={(e) => update('emergencyContactName', e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label>Phone {isRequired('Emergency Contact Phone') && '*'}</Label>
            <Input
              value={form.emergencyContactPhone ?? ''}
              onChange={(e) => update('emergencyContactPhone', e.target.value)}
            />
          </div>
        </div>
      </section>

      <div className="flex gap-2">
        <Button disabled={saving} onClick={() => handleSave(true)}>
          {isComplete ? 'Save' : 'Save & Continue'}
        </Button>
        {!isComplete && (
          <Button variant="outline" disabled={saving} onClick={() => handleSave(false)}>
            Save & Complete Later
          </Button>
        )}
      </div>
    </div>
  )
}
