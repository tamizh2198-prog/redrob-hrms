"use client"

import { useState } from 'react'
import { Button } from '@/components/ui/button'
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
import { confirmEmployee } from '../api'

// Ends probation (ACTIVE_PROBATION -> ACTIVE) — same confirmation-dialog
// pattern as DismissEmployeeDialog.
export function ConfirmEmployeeDialog({
  employeeId,
  employeeName,
  onConfirmed,
}: {
  employeeId: string
  employeeName: string
  onConfirmed: () => void
}) {
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleConfirm() {
    setSubmitting(true)
    setError(null)
    try {
      await confirmEmployee(employeeId)
      setOpen(false)
      onConfirmed()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to confirm employee')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="success">Confirm Employee (End Probation)</Button>} />
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Confirm Employee?</DialogTitle>
          <DialogDescription>
            Are you sure {employeeName} has successfully completed probation? This moves them to Active
            status and assigns their Confirmation Hamper.
          </DialogDescription>
        </DialogHeader>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <DialogFooter>
          <DialogClose render={<Button variant="outline" disabled={submitting} />}>Cancel</DialogClose>
          <Button variant="success" disabled={submitting} onClick={handleConfirm}>
            {submitting ? 'Confirming…' : 'Confirm Employee'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
