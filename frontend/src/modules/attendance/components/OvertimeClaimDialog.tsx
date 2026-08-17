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
import { ApiError } from '@/lib/api'
import { submitOvertimeClaim } from '../api'

// Mirrors RegularizeDialog's structure — a per-row Dialog trigger in the
// Monthly Attendance table's Action cell.
export function OvertimeClaimDialog({
  date,
  currentOvertimeHours,
  onSubmitted,
  trigger,
}: {
  date: string
  currentOvertimeHours: number | null
  onSubmitted: () => void
  trigger?: ReactElement
}) {
  const [open, setOpen] = useState(false)
  const [hoursClaimed, setHoursClaimed] = useState(
    currentOvertimeHours ? String(currentOvertimeHours) : '',
  )
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit() {
    setSubmitting(true)
    setError(null)
    try {
      await submitOvertimeClaim({ date, hoursClaimed: Number(hoursClaimed), reason })
      setOpen(false)
      setReason('')
      onSubmitted()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to submit overtime claim')
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
      <DialogTrigger render={trigger ?? <Button size="sm" variant="outline">Claim OT</Button>} />
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Claim Overtime</DialogTitle>
          <DialogDescription>{date}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <Label>Hours claimed</Label>
            <Input
              type="number"
              min="0.5"
              max="16"
              step="0.5"
              value={hoursClaimed}
              onChange={(e) => setHoursClaimed(e.target.value)}
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
          <Button disabled={submitting || !hoursClaimed || !reason} onClick={handleSubmit}>
            {submitting ? 'Submitting…' : 'Submit'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
