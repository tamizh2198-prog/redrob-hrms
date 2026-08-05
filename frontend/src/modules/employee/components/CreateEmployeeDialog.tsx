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
import {
  createEmployee,
  getReferenceData,
  type Employee,
  type ReferenceData,
} from '../api'

const EMPTY_FORM = {
  firstName: '',
  lastName: '',
  dob: '',
  gender: 'PREFER_NOT_TO_SAY',
  dateOfJoining: '',
  departmentId: '',
  designationId: '',
  reportingManagerId: '',
  pan: '',
  bankAccountNumber: '',
  emergencyContactName: '',
  emergencyContactPhone: '',
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
    }
  }, [open])

  function update<K extends keyof typeof form>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  async function handleSubmit() {
    setSubmitting(true)
    setError(null)
    try {
      await createEmployee({
        ...form,
        status: 'ACTIVE_PROBATION',
      } as Partial<Employee>)
      setForm(EMPTY_FORM)
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
          <DialogTitle>New Employee</DialogTitle>
        </DialogHeader>

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
            <Label>Date of birth</Label>
            <Input type="date" value={form.dob} onChange={(e) => update('dob', e.target.value)} />
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
                <SelectValue placeholder="Select department" />
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
                <SelectValue placeholder="Select designation" />
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
            <Label>Reporting manager</Label>
            <Select
              value={form.reportingManagerId}
              onValueChange={(v) => update('reportingManagerId', v)}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select manager" />
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

          <div className="flex flex-col gap-1">
            <Label>PAN</Label>
            <Input value={form.pan} onChange={(e) => update('pan', e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <Label>Bank account</Label>
            <Input
              value={form.bankAccountNumber}
              onChange={(e) => update('bankAccountNumber', e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label>Emergency contact name</Label>
            <Input
              value={form.emergencyContactName}
              onChange={(e) => update('emergencyContactName', e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label>Emergency contact phone</Label>
            <Input
              value={form.emergencyContactPhone}
              onChange={(e) => update('emergencyContactPhone', e.target.value)}
            />
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
