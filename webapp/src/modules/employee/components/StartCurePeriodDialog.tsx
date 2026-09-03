"use client"

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
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
import { startCurePeriod } from '../api'

// Non-terminal — the employee stays active. Same confirmation-dialog
// pattern as DismissEmployeeDialog, plus an optional reason.
export function StartCurePeriodDialog({
  employeeId,
  employeeName,
  onDone,
}: {
  employeeId: string
  employeeName: string
  onDone: () => void
}) {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleConfirm() {
    setSubmitting(true)
    setError(null)
    try {
      await startCurePeriod(employeeId, reason || undefined)
      setOpen(false)
      setReason('')
      onDone()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to start cure period')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="destructive">Start Cure Period</Button>} />
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Start Cure Period?</DialogTitle>
          <DialogDescription>{employeeName} will be marked as under a Cure Period and notified.</DialogDescription>
        </DialogHeader>

        <Textarea placeholder="Reason (optional)" value={reason} onChange={(e) => setReason(e.target.value)} />
        {error && <p className="text-sm text-destructive">{error}</p>}

        <DialogFooter>
          <DialogClose render={<Button variant="outline" disabled={submitting} />}>Cancel</DialogClose>
          <Button variant="destructive" disabled={submitting} onClick={handleConfirm}>
            {submitting ? 'Saving…' : 'Start Cure Period'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
