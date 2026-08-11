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
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ApiError } from '@/lib/api'
import { createEmployee, getReferenceData, type Employee, type ReferenceData } from '../api'

function label(value: string) {
  return value.replaceAll('_', ' ')
}

const EMPTY_FORM = {
  firstName: '',
  lastName: '',
  gender: 'PREFER_NOT_TO_SAY',
  dateOfJoining: '',
  departmentId: '',
  designationId: '',
  locationId: '',
  reportingManagerId: '',
}

// HR/Super Admin only fill the employment-side basics here — contact info,
// date of birth, statutory IDs, and bank details are self-service fields the
// new hire adds themselves from their own profile page once they have
// access (see SELF_SERVICE_FIELDS / ProfileChangeRequest). Matches
// assertMandatoryFieldsForActive's required set minus DOB/PAN/bank/
// emergency-contact, since those aren't collected here anymore.
const REQUIRED_FIELDS = [
  'firstName',
  'lastName',
  'gender',
  'departmentId',
  'designationId',
  'reportingManagerId',
  'dateOfJoining',
] as const

const FIELD_LABELS: Record<string, string> = {
  firstName: 'First name',
  lastName: 'Last name',
  gender: 'Gender',
  departmentId: 'Department',
  designationId: 'Designation',
  reportingManagerId: 'Reporting manager',
  dateOfJoining: 'Date of joining',
}

export function CreateEmployeeDialog({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false)
  const [reference, setReference] = useState<ReferenceData | null>(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (open) {
      getReferenceData().then(setReference).catch(() => setReference(null))
    } else {
      setForm(EMPTY_FORM)
      setError(null)
    }
  }, [open])

  function update<K extends keyof typeof form>(key: K, value: string) {
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
    try {
      const payload = Object.fromEntries(
        Object.entries(form).map(([key, value]) => [key, value || undefined]),
      )
      await createEmployee({
        ...payload,
        // Pre-Day-1 state: the new hire completes their own contact/
        // statutory/bank details before this ever needs to become
        // ACTIVE_PROBATION (which would otherwise reject this create for
        // missing PAN/bank account/emergency contact).
        status: 'PREBOARDING',
      } as Partial<Employee>)
      setOpen(false)
      onCreated()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create employee')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button>New Employee</Button>} />
      <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New Employee — Employment Details</DialogTitle>
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
            <Label>Gender</Label>
            <Select value={form.gender} onValueChange={(v) => update('gender', v)}>
              <SelectTrigger className="w-full">
                <SelectValue>{(v: string) => label(v)}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="MALE">Male</SelectItem>
                <SelectItem value="FEMALE">Female</SelectItem>
                <SelectItem value="OTHER">Other</SelectItem>
                <SelectItem value="PREFER_NOT_TO_SAY">Prefer not to say</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <Label>Date of joining</Label>
            <Input
              type="date"
              value={form.dateOfJoining}
              onChange={(e) => update('dateOfJoining', e.target.value)}
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
            <Label>Designation</Label>
            <Select value={form.designationId} onValueChange={(v) => update('designationId', v)}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select designation">
                  {(value: string) =>
                    reference?.designations.find((d) => d.id === value)?.name ?? 'Select designation'
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {reference?.designations.map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="col-span-2 flex flex-col gap-1">
            <Label>Assigned location</Label>
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
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <Button disabled={submitting} onClick={handleSubmit}>
          Create
        </Button>
      </DialogContent>
    </Dialog>
  )
}
