import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ApiError } from '@/lib/api'
import { useAuth } from '@/shared/auth/AuthContext'
import type { Role } from '@/shared/auth/role'
import { inviteEmployee, getReferenceData, type ReferenceData } from '../api'

const EMPTY_FORM = {
  firstName: '',
  lastName: '',
  email: '',
  employeeCode: '',
  departmentId: '',
  locationId: '',
  reportingManagerId: '',
  role: 'EMPLOYEE' as Role,
}

// This task (security review): explicit missing-field error instead of a
// silently-disabled submit button. Matches the fields this invite-based
// form actually collects and canSubmit already gates on.
const REQUIRED_FIELDS = ['firstName', 'lastName', 'email', 'employeeCode'] as const

const FIELD_LABELS: Record<string, string> = {
  firstName: 'First name',
  lastName: 'Last name',
  email: 'Work email',
  employeeCode: 'Employee code',
}

const ROLES: Role[] = ['EMPLOYEE', 'MANAGER', 'HR_ADMIN', 'SUPER_ADMIN']

// This task: the ONE employee-creation path. Collects only the basic
// administrative fields needed to create the record — the employee fills
// in their own personal/payroll profile later (Auth Phase 3). On submit
// this reuses the existing Phase 2 invite endpoint, so status is always
// INVITED and an invitation email is always sent — there is no longer a
// separate "New Employee" flow that skips the invitation.
export function CreateEmployeeDialog({ onCreated }: { onCreated: () => void }) {
  const { user } = useAuth()
  const canAssignPrivilegedRole = user?.role === 'SUPER_ADMIN'

  const [open, setOpen] = useState(false)
  const [reference, setReference] = useState<ReferenceData | null>(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (open) {
      getReferenceData().then(setReference).catch(() => setReference(null))
    } else {
      setForm(EMPTY_FORM)
      setError(null)
    }
  }, [open])

  function update<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  async function handleSubmit() {
    const missing = REQUIRED_FIELDS.filter((f) => !form[f])
    if (missing.length > 0) {
      setError(`Missing required field(s): ${missing.map((f) => FIELD_LABELS[f]).join(', ')}`)
      return
    }
    setSubmitting(true)
    setError(null)
    setMessage(null)
    try {
      const result = await inviteEmployee({
        firstName: form.firstName,
        lastName: form.lastName,
        email: form.email,
        employeeCode: form.employeeCode,
        departmentId: form.departmentId || undefined,
        locationId: form.locationId || undefined,
        reportingManagerId: form.reportingManagerId || undefined,
        role: form.role,
      })
      setMessage(
        result.emailSent
          ? 'Employee created. Invitation sent.'
          : 'Employee created, but the invitation email could not be sent. Use "Remind" from the directory once email is configured.',
      )
      setForm(EMPTY_FORM)
      onCreated()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create employee')
    } finally {
      setSubmitting(false)
    }
  }

  const canSubmit =
    !submitting && form.firstName && form.lastName && form.employeeCode && form.email

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) {
          setError(null)
          setMessage(null)
          setForm(EMPTY_FORM)
        }
      }}
    >
      <DialogTrigger render={<Button>+ Create Employee</Button>} />
      <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create Employee</DialogTitle>
        </DialogHeader>

        <p className="text-sm text-muted-foreground">
          Contact details, statutory IDs, and bank details are added by the employee themselves
          from their own profile once their account is active.
        </p>

        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1">
            <Label>First name</Label>
            <Input value={form.firstName} onChange={(e) => update('firstName', e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <Label>Last name</Label>
            <Input value={form.lastName} onChange={(e) => update('lastName', e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <Label>Work email</Label>
            <Input
              type="email"
              value={form.email}
              onChange={(e) => update('email', e.target.value)}
              placeholder="employee@company.com"
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label>Employee code</Label>
            <Input
              value={form.employeeCode}
              onChange={(e) => update('employeeCode', e.target.value)}
              placeholder="EMP-2026-0010"
            />
          </div>

          <div className="flex flex-col gap-1">
            <Label>Department</Label>
            <Select value={form.departmentId} onValueChange={(v) => update('departmentId', v)}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select department">
                  {(value: string) =>
                    reference?.departments.find((d) => d.id === value)?.name ?? 'Select department'
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {reference?.departments.map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <Label>Location</Label>
            <Select value={form.locationId} onValueChange={(v) => update('locationId', v)}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select location">
                  {(value: string) =>
                    reference?.locations.find((l) => l.id === value)?.name ?? 'Select location'
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {reference?.locations.map((l) => (
                  <SelectItem key={l.id} value={l.id}>
                    {l.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="col-span-2 flex flex-col gap-1">
            <Label>Reporting manager</Label>
            <Select
              value={form.reportingManagerId}
              onValueChange={(v) => update('reportingManagerId', v)}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select manager">
                  {(value: string) => {
                    const m = reference?.managers.find((mgr) => mgr.id === value)
                    return m ? `${m.firstName} ${m.lastName} (${m.employeeCode})` : 'Select manager'
                  }}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {reference?.managers.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.firstName} {m.lastName} ({m.employeeCode})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="col-span-2 flex flex-col gap-1">
            <Label>Role</Label>
            <Select value={form.role} onValueChange={(v) => update('role', v as Role)}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select role">
                  {(value: string) => value.replaceAll('_', ' ')}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {ROLES.map((r) => (
                  <SelectItem
                    key={r}
                    value={r}
                    disabled={(r === 'SUPER_ADMIN' || r === 'HR_ADMIN') && !canAssignPrivilegedRole}
                  >
                    {r.replaceAll('_', ' ')}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}
        {message && <p className="text-sm text-primary">{message}</p>}

        <DialogFooter>
          <Button disabled={!canSubmit} onClick={handleSubmit}>
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
