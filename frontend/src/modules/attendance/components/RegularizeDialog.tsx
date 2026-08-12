import { useState, type ReactElement } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ApiError } from '@/lib/api'
import { regularize, type AttendanceStatus, type CalendarDayStatus } from '../api'

const REQUESTABLE_STATUSES: AttendanceStatus[] = ['PRESENT', 'HALF_DAY', 'WFH']

// This task: regularization must happen from the same page, per-row, via
// the existing Dialog convention (CreateEmployeeDialog/DismissEmployeeDialog)
// — reuses the existing POST /attendance/regularize API and its server-side
// validation (7-day submission window, etc.) unchanged.
export function RegularizeDialog({
  date,
  currentStatus,
  onSubmitted,
  trigger,
}: {
  date: string
  currentStatus: CalendarDayStatus
  onSubmitted: () => void
  trigger?: ReactElement
}) {
  const [open, setOpen] = useState(false)
  const [requestedStatus, setRequestedStatus] = useState<AttendanceStatus>('PRESENT')
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit() {
    setSubmitting(true)
    setError(null)
    try {
      await regularize({ date, requestedStatus, reason })
      setOpen(false)
      setReason('')
      onSubmitted()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to submit regularization')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) setError(null)
      }}
    >
      <DialogTrigger render={trigger ?? <Button size="sm" variant="outline">Regularize</Button>} />
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Regularize Attendance</DialogTitle>
          <DialogDescription>
            {date} — currently marked {currentStatus.replaceAll('_', ' ')}.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <Label>Requested status</Label>
            <Select
              value={requestedStatus}
              onValueChange={(v) => setRequestedStatus(v as AttendanceStatus)}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {REQUESTABLE_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s.replaceAll('_', ' ')}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <Label>Reason</Label>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <DialogFooter>
          <DialogClose render={<Button variant="outline" disabled={submitting} />}>
            Cancel
          </DialogClose>
          <Button disabled={submitting || !reason} onClick={handleSubmit}>
            {submitting ? 'Submitting…' : 'Submit'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
