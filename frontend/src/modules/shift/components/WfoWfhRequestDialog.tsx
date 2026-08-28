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
import { submitWfoWfhRequest } from '../api'

// A per-page Dialog trigger, not a full form page — both dates here are
// user-picked, since this is an employee-initiated action in the Shift
// module.
export function WfoWfhRequestDialog({
  onSubmitted,
  trigger,
}: {
  onSubmitted: () => void
  trigger?: ReactElement
}) {
  const [open, setOpen] = useState(false)
  const [originalDate, setOriginalDate] = useState('')
  const [requestedWorkMode, setRequestedWorkMode] = useState<'OFFICE' | 'WORK_FROM_HOME'>('WORK_FROM_HOME')
  const [compensatoryDate, setCompensatoryDate] = useState('')
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit() {
    setSubmitting(true)
    setError(null)
    try {
      await submitWfoWfhRequest({ originalDate, requestedWorkMode, compensatoryDate, reason })
      setOpen(false)
      setOriginalDate('')
      setCompensatoryDate('')
      setReason('')
      onSubmitted()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to submit request')
    } finally {
      setSubmitting(false)
    }
  }

  const canSubmit = originalDate && compensatoryDate && reason && !submitting

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) setError(null)
      }}
    >
      <DialogTrigger render={trigger ?? <Button size="sm">Request WFO/WFH Change</Button>} />
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Request WFO/WFH Change</DialogTitle>
          <DialogDescription>
            Pick the date you want changed and a compensatory date where you'll work the
            opposite mode in exchange.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <Label>Date to change</Label>
            <Input type="date" value={originalDate} onChange={(e) => setOriginalDate(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <Label>Change to</Label>
            <Select
              value={requestedWorkMode}
              onValueChange={(v) => setRequestedWorkMode(v as 'OFFICE' | 'WORK_FROM_HOME')}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="WORK_FROM_HOME">Work From Home</SelectItem>
                <SelectItem value="OFFICE">Office</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <Label>Compensatory date (you'll work the opposite mode)</Label>
            <Input
              type="date"
              value={compensatoryDate}
              onChange={(e) => setCompensatoryDate(e.target.value)}
            />
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
          <Button disabled={!canSubmit} onClick={handleSubmit}>
            {submitting ? 'Submitting…' : 'Submit'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
